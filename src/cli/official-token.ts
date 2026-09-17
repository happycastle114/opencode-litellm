import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isHeaderSafeApiKey } from '../utils/api-key'
import { PathResolutionError, type PathEnv } from './paths'
import {
  NativeLiteCommand,
  NativeLiteError,
  nativeLiteTokenPath,
  runNativeLite,
  type NativeLiteBoundary,
} from './native-lite'

const TOKEN_FIELD = {
  baseURL: 'base_url',
  key: 'key',
} as const
const MANUAL_KEY_PATH = ['opencode-litellm', 'api-key.json'] as const

export type OfficialLiteLLMTokenOptions = {
  readonly tokenFilePath?: string
  readonly expectedBaseURL?: string
  readonly native?: NativeLiteBoundary
}

export function loadOfficialLiteLLMApiKey(
  options: OfficialLiteLLMTokenOptions,
): string | undefined {
  if (options.expectedBaseURL === undefined) return undefined
  const metadata = readTokenRecord(options.tokenFilePath ?? nativeLiteTokenPath())
  if (metadata === undefined ||
    metadata[TOKEN_FIELD.baseURL] !== options.expectedBaseURL.replace(/\/+$/, '')) return undefined
  try {
    return runNativeLite({
      command: NativeLiteCommand.Token,
      baseUrl: options.expectedBaseURL,
      tokenFilePath: options.tokenFilePath,
    }, options.native)
  } catch (error) {
    if (error instanceof NativeLiteError) return undefined
    throw error
  }
}

export function loadEnvKey(
  tokenFilePath: string,
  expectedBaseURL: string,
): string | undefined {
  const parsed = readTokenRecord(tokenFilePath)
  if (parsed === undefined) return undefined
  const storedBaseURL = parsed[TOKEN_FIELD.baseURL]
  const key = parsed[TOKEN_FIELD.key]
  if (
    typeof storedBaseURL !== 'string' ||
    !isHeaderSafeApiKey(key)
  ) {
    return undefined
  }

  if (storedBaseURL !== expectedBaseURL.replace(/\/+$/, '')) {
    return undefined
  }

  return key
}

export function resolveManualLiteLLMApiKeyPath(env: PathEnv): string {
  if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== '') {
    return join(env.XDG_CONFIG_HOME, ...MANUAL_KEY_PATH)
  }
  if (env.HOME !== undefined && env.HOME !== '') {
    return join(env.HOME, '.config', ...MANUAL_KEY_PATH)
  }
  throw new PathResolutionError('Unable to resolve the manual LiteLLM API-key path: set HOME or XDG_CONFIG_HOME.')
}

function readTokenRecord(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if (error instanceof SyntaxError ||
      error instanceof Error && 'code' in error) return undefined
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
