import { spawnSync } from 'node:child_process'
import { CodexMode } from './install-intent'

export const AgentCommand = {
  Claude: 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
} as const

export type AgentCommand = (typeof AgentCommand)[keyof typeof AgentCommand]
export type AgentCodexMode = (typeof CodexMode)[keyof typeof CodexMode]

export type AgentLaunchInput = {
  readonly command: AgentCommand | string
  readonly args: readonly string[]
  readonly gatewayOrigin: string
  readonly apiKey?: string
  readonly codexMode?: AgentCodexMode
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export type AgentProcessResult = {
  readonly status: number | null
  readonly signal: string | null
}

export type AgentSpawnOptions = {
  readonly stdio: 'inherit'
  readonly env: Readonly<Record<string, string | undefined>>
}

export type AgentLaunchBoundary = {
  readonly which?: (command: AgentCommand) => string | undefined
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: AgentSpawnOptions,
  ) => AgentProcessResult
}

export class AgentLaunchError extends Error {
  readonly name = 'AgentLaunchError'
}

const EnvironmentName = {
  AnthropicApiKey: 'ANTHROPIC_API_KEY',
  AnthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  AnthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  AnthropicCustomHeaders: 'ANTHROPIC_CUSTOM_HEADERS',
  CodexApiKey: 'CODEX_API_KEY',
  GatewayApiKey: 'LITELLM_PROXY_API_KEY',
  GatewayUrl: 'LITELLM_PROXY_URL',
  LiteLLMApiKey: 'LITELLM_API_KEY',
  LiteLLMMasterKey: 'LITELLM_MASTER_KEY',
  OpenAiApiKey: 'OPENAI_API_KEY',
  OpenAiBaseUrl: 'OPENAI_BASE_URL',
  OpenCodeApiKey: 'OPENCODE_LITELLM_API_KEY',
} as const

const CodexArgument = {
  Profile: '--profile',
  OAuthProfile: 'codex-oauth',
} as const

const ClaudeMaxPath = '/claude-max'
const ProxyAdmissionHeader = 'x-litellm-api-key'
const SECRET_ENVIRONMENT_NAMES = [
  EnvironmentName.GatewayApiKey,
  EnvironmentName.LiteLLMApiKey,
  EnvironmentName.LiteLLMMasterKey,
  EnvironmentName.OpenCodeApiKey,
] as const

export function launchAgent(
  input: AgentLaunchInput,
  boundary: AgentLaunchBoundary = defaultBoundary(),
): AgentProcessResult {
  const command = parseAgentCommand(input.command)
  if (command === undefined) {
    throw new AgentLaunchError(`Unsupported agent command '${input.command}'.`)
  }

  const origin = normalizeGatewayOrigin(input.gatewayOrigin)
  const executable = resolveExecutable(command, boundary)
  const childEnvironment = buildChildEnvironment(command, input, origin)
  const args = buildAgentArguments(command, input.args, input.codexMode)

  try {
    return boundary.spawn(executable, args, {
      stdio: 'inherit',
      env: childEnvironment,
    })
  } catch (error) {
    if (isExecutableNotFound(error)) {
      throw new AgentLaunchError(
        `The '${command}' executable was not found on PATH.`,
      )
    }
    throw error
  }
}

function resolveExecutable(
  command: AgentCommand,
  boundary: AgentLaunchBoundary,
): string {
  try {
    const executable = boundary.which === undefined
      ? command
      : boundary.which(command)
    if (executable !== undefined) return executable
  } catch (error) {
    if (!isExecutableNotFound(error)) throw error
  }
  throw new AgentLaunchError(`The '${command}' executable was not found on PATH.`)
}

function parseAgentCommand(value: string): AgentCommand | undefined {
  switch (value) {
    case AgentCommand.Claude:
    case AgentCommand.Codex:
    case AgentCommand.OpenCode:
      return value
    default:
      return undefined
  }
}

function normalizeGatewayOrigin(value: string): string {
  const origin = value.replace(/\/+$/, '')
  if (origin === '') {
    throw new AgentLaunchError('A non-empty LiteLLM gateway origin is required.')
  }
  return origin
}

function buildChildEnvironment(
  command: AgentCommand,
  input: AgentLaunchInput,
  origin: string,
): Readonly<Record<string, string | undefined>> {
  const environment: Record<string, string | undefined> = {
    ...(input.environment ?? process.env),
  }

  switch (command) {
    case AgentCommand.Claude:
      return buildClaudeEnvironment(environment, origin, input.apiKey)
    case AgentCommand.Codex:
      return buildCodexEnvironment(environment, input.apiKey)
    case AgentCommand.OpenCode:
      return buildOpenCodeEnvironment(environment, origin)
    default:
      return assertNever(command)
  }
}

function buildClaudeEnvironment(
  environment: Record<string, string | undefined>,
  origin: string,
  apiKey: string | undefined,
): Readonly<Record<string, string | undefined>> {
  const key = requireApiKey(AgentCommand.Claude, apiKey)
  deleteKnownSecrets(environment)
  delete environment[EnvironmentName.AnthropicApiKey]
  delete environment[EnvironmentName.AnthropicAuthToken]
  environment[EnvironmentName.AnthropicBaseUrl] = `${origin}${ClaudeMaxPath}`
  environment[EnvironmentName.AnthropicCustomHeaders] =
    `${ProxyAdmissionHeader}: Bearer ${key}`
  return environment
}

function buildCodexEnvironment(
  environment: Record<string, string | undefined>,
  apiKey: string | undefined,
): Readonly<Record<string, string | undefined>> {
  const key = requireApiKey(AgentCommand.Codex, apiKey)
  deleteKnownSecrets(environment)
  delete environment[EnvironmentName.CodexApiKey]
  delete environment[EnvironmentName.OpenAiApiKey]
  delete environment[EnvironmentName.OpenAiBaseUrl]
  environment[EnvironmentName.GatewayApiKey] = key
  return environment
}

function buildOpenCodeEnvironment(
  environment: Record<string, string | undefined>,
  origin: string,
): Readonly<Record<string, string | undefined>> {
  deleteKnownSecrets(environment)
  environment[EnvironmentName.GatewayUrl] = origin
  return environment
}

function deleteKnownSecrets(environment: Record<string, string | undefined>): void {
  for (const name of SECRET_ENVIRONMENT_NAMES) delete environment[name]
}

function requireApiKey(command: AgentCommand, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new AgentLaunchError(`A LiteLLM API key is required to launch '${command}'.`)
  }
  if (/[\r\n]/.test(value)) {
    throw new AgentLaunchError('The LiteLLM API key contains invalid header characters.')
  }
  return value
}

function buildAgentArguments(
  command: AgentCommand,
  args: readonly string[],
  mode: AgentCodexMode | undefined,
): readonly string[] {
  if (command !== AgentCommand.Codex || mode !== CodexMode.OAuth || hasExplicitProfile(args)) {
    return [...args]
  }
  return [CodexArgument.Profile, CodexArgument.OAuthProfile, ...args]
}

function hasExplicitProfile(args: readonly string[]): boolean {
  return args.some((arg) =>
    arg === CodexArgument.Profile || arg.startsWith(`${CodexArgument.Profile}=`),
  )
}

function isExecutableNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if ('code' in error && error.code === 'ENOENT') return true
  return error.message.includes('ENOENT') || error.message.includes('not found')
}

function defaultBoundary(): AgentLaunchBoundary {
  return {
    spawn: (file, args, options) => {
      const result = spawnSync(file, [...args], {
        stdio: options.stdio,
        env: { ...options.env },
      })
      if (result.error !== undefined) throw result.error
      return { status: result.status, signal: result.signal }
    },
  }
}

function assertNever(value: never): never {
  throw new AgentLaunchError(`Unexpected agent command '${String(value)}'.`)
}
