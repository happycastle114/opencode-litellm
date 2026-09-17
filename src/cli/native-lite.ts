import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { isHeaderSafeApiKey } from '../utils/api-key'

export const NativeLiteCommand = {
  Token: 'token',
  Login: 'login',
  Logout: 'logout',
} as const
export type NativeLiteCommand = (typeof NativeLiteCommand)[keyof typeof NativeLiteCommand]

export const NativeLiteErrorCode = {
  InvalidOrigin: 'invalid-origin',
  InvalidTokenPath: 'invalid-token-path',
  Unavailable: 'unavailable',
  Failed: 'failed',
  InvalidToken: 'invalid-token',
} as const
export type NativeLiteErrorCode = (typeof NativeLiteErrorCode)[keyof typeof NativeLiteErrorCode]

const NATIVE_LITE = {
  executable: 'lite',
  directory: '.litellm',
  file: 'token.json',
  baseUrlOption: '--base-url',
  tokenArgs: ['auth', 'print-token'],
  loginArgs: ['login', '--pkce'],
  logoutArgs: ['logout'],
  commandTimeoutMs: 30_000,
  loginTimeoutMs: 300_000,
  maxBufferBytes: 64 * 1024,
} as const

export type NativeLiteSpawnOptions = {
  readonly encoding: 'utf8'
  readonly stdio: 'pipe' | 'inherit'
  readonly env: Readonly<Record<string, string | undefined>>
  readonly timeout: number
  readonly maxBuffer: number
  readonly shell: false
}

export type NativeLiteProcessResult = {
  readonly status: number | null
  readonly stdout: string | null
  readonly stderr: string | null
  readonly error?: Error
}

export type NativeLiteSpawn = (
  executable: string,
  args: readonly string[],
  options: NativeLiteSpawnOptions,
) => NativeLiteProcessResult

export type NativeLiteBoundary = {
  readonly spawn?: NativeLiteSpawn
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export type NativeLiteRequest = {
  readonly command: NativeLiteCommand
  readonly baseUrl: string
  readonly tokenFilePath?: string
}

export class NativeLiteError extends Error {
  readonly name = 'NativeLiteError'

  constructor(readonly code: NativeLiteErrorCode) {
    super(code === NativeLiteErrorCode.Unavailable
      ? "The official LiteLLM CLI is required. Install it with: uv tool install 'litellm[cli]'"
      : `Official LiteLLM CLI authentication failed (${code}).`)
  }
}

export function nativeLiteHome(tokenFilePath?: string): string {
  if (tokenFilePath === undefined) return process.env.HOME ?? homedir()
  const directory = dirname(tokenFilePath)
  if (basename(tokenFilePath) !== NATIVE_LITE.file || basename(directory) !== NATIVE_LITE.directory) {
    throw new NativeLiteError(NativeLiteErrorCode.InvalidTokenPath)
  }
  return dirname(directory)
}

export function nativeLiteTokenPath(homeDirectory = process.env.HOME ?? homedir()): string {
  return join(homeDirectory, NATIVE_LITE.directory, NATIVE_LITE.file)
}

export function runNativeLite(
  input: NativeLiteRequest,
  boundary: NativeLiteBoundary = {},
): string {
  const baseUrl = nativeLiteOrigin(input.baseUrl)
  const environment: Record<string, string | undefined> = {
    ...(boundary.environment ?? process.env),
    HOME: nativeLiteHome(input.tokenFilePath),
  }
  delete environment.LITELLM_PROXY_API_KEY
  delete environment.LITELLM_PROXY_URL
  if (process.platform === 'win32') environment.USERPROFILE = environment.HOME
  const interactive = input.command === NativeLiteCommand.Login
  const result = (boundary.spawn ?? spawnNativeLite)(
    NATIVE_LITE.executable,
    [NATIVE_LITE.baseUrlOption, baseUrl, ...commandArgs(input.command)],
    {
      encoding: 'utf8',
      stdio: interactive ? 'inherit' : 'pipe',
      env: environment,
      timeout: interactive ? NATIVE_LITE.loginTimeoutMs : NATIVE_LITE.commandTimeoutMs,
      maxBuffer: NATIVE_LITE.maxBufferBytes,
      shell: false,
    },
  )
  if (result.error !== undefined) {
    throw new NativeLiteError(isMissingExecutable(result.error)
      ? NativeLiteErrorCode.Unavailable
      : NativeLiteErrorCode.Failed)
  }
  if (result.status !== 0) throw new NativeLiteError(NativeLiteErrorCode.Failed)
  const output = result.stdout ?? ''
  if (input.command !== NativeLiteCommand.Token) return output
  const token = output.replace(/\r?\n$/, '')
  if (!isHeaderSafeApiKey(token)) throw new NativeLiteError(NativeLiteErrorCode.InvalidToken)
  return token
}

export function nativeLiteOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    if (error instanceof TypeError) throw new NativeLiteError(NativeLiteErrorCode.InvalidOrigin)
    throw error
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new NativeLiteError(NativeLiteErrorCode.InvalidOrigin)
  }
  return value.replace(/\/+$/, '')
}

function commandArgs(command: NativeLiteCommand): readonly string[] {
  switch (command) {
    case NativeLiteCommand.Token: return NATIVE_LITE.tokenArgs
    case NativeLiteCommand.Login: return NATIVE_LITE.loginArgs
    case NativeLiteCommand.Logout: return NATIVE_LITE.logoutArgs
    default: return assertNever(command)
  }
}

function spawnNativeLite(
  executable: string,
  args: readonly string[],
  options: NativeLiteSpawnOptions,
): NativeLiteProcessResult {
  return spawnSync(executable, [...args], options)
}

function isMissingExecutable(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
}

function assertNever(value: never): never {
  throw new NativeLiteError(NativeLiteErrorCode.Failed)
}
