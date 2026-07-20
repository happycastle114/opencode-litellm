import { spawnSync } from 'node:child_process'
import { Writable } from 'node:stream'
import {
  createInterface as createReadlineInterface,
  type Interface as ReadlineInterface,
  type ReadLineOptions,
} from 'node:readline/promises'
import type { OnboardingIO } from './onboarding'
import type { SsoOnboardingBoundaries, SsoTeam, SsoVerification } from './onboarding-sso'

const URL_PROTOCOL = { Http: 'http:', Https: 'https:' } as const
const INPUT_TOKEN = { Default: '' } as const

export const NodePlatform = {
  Darwin: 'darwin',
  Linux: 'linux',
  Windows: 'win32',
} as const
export type NodePlatformValue = (typeof NodePlatform)[keyof typeof NodePlatform]
export type NodePlatform = NodePlatformValue

export type NodeReadline = Pick<ReadlineInterface, 'question' | 'close'>
export type NodeReadlineOptions = Omit<ReadLineOptions, 'input' | 'output'> & {
  readonly input: NodeTerminalInput
  readonly output: NodeTerminalOutput
}
export type NodeReadlineFactory = (options: NodeReadlineOptions) => NodeReadline
export type NodeReadlineBoundary =
  | NodeReadlineFactory
  | { readonly createInterface: NodeReadlineFactory }
export type NodeTerminalInput = NodeJS.ReadableStream & { readonly isTTY?: boolean }
export type NodeTerminalOutput = Pick<NodeJS.WritableStream, 'write'>

export type NodeOnboardingIOOptions = {
  readonly input?: NodeTerminalInput
  readonly output?: NodeTerminalOutput
  readonly readline?: NodeReadlineBoundary
}

export type NodeOnboardingIO = OnboardingIO & { readonly close: () => void }

export function createNodeOnboardingIO(options: NodeOnboardingIOOptions = {}): NodeOnboardingIO {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const readline = options.readline === undefined
    ? createReadlineInterface({ input, output: readlineOutput(output), terminal: input.isTTY === true })
    : resolveReadline(options.readline)({ input, output, terminal: input.isTTY === true })
  let closed = false
  return {
    isTTY: input.isTTY === true,
    prompt: (message) => readline.question(message),
    write: (message) => { output.write(`${message}\n`) },
    close: () => {
      if (closed) return
      closed = true
      readline.close()
    },
  }
}

function resolveReadline(boundary: NodeReadlineBoundary): NodeReadlineFactory {
  return typeof boundary === 'function' ? boundary : boundary.createInterface
}

function readlineOutput(output: NodeTerminalOutput): NodeJS.WritableStream {
  if (output === process.stdout) return process.stdout
  return new Writable({
    write(chunk, _encoding, callback) {
      output.write(typeof chunk === 'string' ? chunk : chunk.toString())
      callback()
    },
  })
}

export type NodeSpawnOptions = {
  readonly detached: true
  readonly stdio: 'ignore'
}

export type NodeSpawnCall = {
  readonly file: string
  readonly args: readonly string[]
  readonly options: NodeSpawnOptions
}

export type NodeSpawnResult = {
  readonly status?: number | null
  readonly error?: unknown
}

export type NodeSpawnFunction = (
  file: string,
  args: readonly string[],
  options: NodeSpawnOptions,
) => NodeSpawnResult | void

export type NodeSpawnBoundary = NodeSpawnFunction | { readonly spawn: NodeSpawnFunction }

export type NodeSsoOnboardingBoundariesOptions = {
  readonly platform?: NodePlatform
  readonly spawn?: NodeSpawnBoundary
}

export const NodeSsoBoundaryErrorCode = {
  UnsupportedPlatform: 'unsupported-platform',
  InvalidVerificationUrl: 'invalid-verification-url',
  BrowserLaunch: 'browser-launch-failed',
  InvalidTeamSelection: 'invalid-team-selection',
} as const
export type NodeSsoBoundaryErrorCode =
  (typeof NodeSsoBoundaryErrorCode)[keyof typeof NodeSsoBoundaryErrorCode]

export class NodeSsoBoundaryError extends Error {
  readonly name = 'NodeSsoBoundaryError'

  constructor(
    readonly code: NodeSsoBoundaryErrorCode,
    readonly platform: string,
    readonly executable?: string,
  ) {
    super(`LiteLLM SSO ${code}.`)
  }
}

export function createNodeSsoOnboardingBoundaries(
  io: OnboardingIO,
  options: NodeSsoOnboardingBoundariesOptions = {},
): SsoOnboardingBoundaries {
  const platform = options.platform ?? process.platform
  const spawn = resolveSpawn(options.spawn)
  return {
    open: async (verification) => openVerification({ io, verification, platform, launch: spawn }),
    selectTeam: (teams) => selectTeam(io, teams),
  }
}

function resolveSpawn(boundary: NodeSpawnBoundary | undefined): NodeSpawnFunction {
  if (boundary === undefined) return defaultSpawn
  return typeof boundary === 'function' ? boundary : boundary.spawn
}

type OpenVerificationContext = {
  readonly io: OnboardingIO
  readonly verification: SsoVerification
  readonly platform: string
  readonly launch: NodeSpawnFunction
}

async function openVerification(context: OpenVerificationContext): Promise<void> {
  const url = validVerificationUrl(context.verification.url, context.platform)
  const command = launchCommand(context.platform, url)
  context.io.write(`Verification URL: ${url}`)
  context.io.write(`Verification code: ${context.verification.userCode}`)
  try {
    const result = context.launch(command.file, command.args, { detached: true, stdio: 'ignore' })
    if (result !== undefined && result.status !== undefined && result.status !== 0) {
      throw new NodeSsoBoundaryError(
        NodeSsoBoundaryErrorCode.BrowserLaunch,
        context.platform,
        command.file,
      )
    }
    if (result !== undefined && result.error !== undefined) {
      throw new NodeSsoBoundaryError(
        NodeSsoBoundaryErrorCode.BrowserLaunch,
        context.platform,
        command.file,
      )
    }
  } catch (error) {
    if (error instanceof NodeSsoBoundaryError) throw error
    throw new NodeSsoBoundaryError(
      NodeSsoBoundaryErrorCode.BrowserLaunch,
      context.platform,
      command.file,
    )
  }
}

function validVerificationUrl(value: string, platform: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new NodeSsoBoundaryError(NodeSsoBoundaryErrorCode.InvalidVerificationUrl, platform)
  }
  if (
    (url.protocol !== URL_PROTOCOL.Http && url.protocol !== URL_PROTOCOL.Https) ||
    url.username.length > 0 || url.password.length > 0
  ) {
    throw new NodeSsoBoundaryError(NodeSsoBoundaryErrorCode.InvalidVerificationUrl, platform)
  }
  return value
}

function launchCommand(platform: string, url: string): { readonly file: string; readonly args: readonly string[] } {
  switch (platform) {
    case NodePlatform.Darwin:
      return { file: 'open', args: [url] }
    case NodePlatform.Linux:
      return { file: 'xdg-open', args: [url] }
    case NodePlatform.Windows:
      return { file: 'cmd.exe', args: ['/c', 'start', '', url] }
    default:
      throw new NodeSsoBoundaryError(NodeSsoBoundaryErrorCode.UnsupportedPlatform, platform)
  }
}

async function selectTeam(io: OnboardingIO, teams: readonly SsoTeam[]): Promise<string | undefined> {
  if (teams.length === 0) return undefined
  io.write(teams.map(formatTeam).join('\n'))
  if (teams.length === 1) return teams[0]?.teamId
  while (true) {
    const answer = (await io.prompt('Choose a team number')).trim()
    if (answer === INPUT_TOKEN.Default) return undefined
    if (/^[1-9]\d*$/.test(answer)) {
      const index = Number(answer)
      if (Number.isSafeInteger(index) && index <= teams.length) return teams[index - 1]?.teamId
    }
    io.write('Enter one of the listed team numbers.')
  }
}

function formatTeam(team: SsoTeam, index: number): string {
  const label = team.teamAlias === undefined ? team.teamId : `${team.teamAlias} (${team.teamId})`
  return `${index + 1}. ${label}`
}

function defaultSpawn(file: string, args: readonly string[], options: NodeSpawnOptions): NodeSpawnResult {
  const result = spawnSync(file, [...args], options)
  return { status: result.status, error: result.error }
}
