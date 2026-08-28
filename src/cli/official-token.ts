import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isHeaderSafeApiKey } from '../utils/api-key'

const TOKEN_FIELD = {
  baseURL: 'base_url',
  key: 'key',
  userRole: 'user_role',
} as const
const TOKEN_USER_ROLE = {
  Cli: 'cli',
} as const
const TOKEN_FILE_RELATIVE_PATH = ['.litellm', 'token.json'] as const

export type OfficialLiteLLMTokenOptions = {
  readonly tokenFilePath?: string
  readonly expectedBaseURL?: string
}

/**
 * Read the credential written by LiteLLM's official `lite login` flow.
 *
 * LiteLLM compares the stored URL with the caller's URL after applying
 * `rstrip("/")` to the caller value only. Keeping that asymmetry matters:
 * normalising the stored value could make a credential issued for a different
 * path appear valid. The CLI stores the API credential in `key`; the
 * `jwt_token` field is deliberately ignored.
 */
export function loadOfficialLiteLLMApiKey(
  options: OfficialLiteLLMTokenOptions,
): string | undefined {
  const tokenFilePath =
    options.tokenFilePath ??
    join(process.env.HOME ?? homedir(), ...TOKEN_FILE_RELATIVE_PATH)
  let raw: string
  try {
    raw = readFileSync(tokenFilePath, 'utf8')
  } catch {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const storedBaseURL = parsed[TOKEN_FIELD.baseURL]
  const key = parsed[TOKEN_FIELD.key]
  if (
    typeof storedBaseURL !== 'string' ||
    !isHeaderSafeApiKey(key)
  ) {
    return undefined
  }

  if (
    options.expectedBaseURL !== undefined &&
    storedBaseURL !== options.expectedBaseURL.replace(/\/+$/, '')
  ) {
    return undefined
  }

  return key
}

/**
 * Load only CLI-entered keys (user_role === 'cli'), not SSO keys.
 * This prevents SSO credentials from being used in env auth mode.
 */
export function loadEnvKey(
  tokenFilePath: string,
  expectedBaseURL: string,
): string | undefined {
  let raw: string
  try {
    raw = readFileSync(tokenFilePath, 'utf8')
  } catch {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const storedBaseURL = parsed[TOKEN_FIELD.baseURL]
  const key = parsed[TOKEN_FIELD.key]
  const userRole = parsed[TOKEN_FIELD.userRole]
  if (
    typeof storedBaseURL !== 'string' ||
    !isHeaderSafeApiKey(key) ||
    userRole !== TOKEN_USER_ROLE.Cli
  ) {
    return undefined
  }

  if (storedBaseURL !== expectedBaseURL.replace(/\/+$/, '')) {
    return undefined
  }

  return key
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
