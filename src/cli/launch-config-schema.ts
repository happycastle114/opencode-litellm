import {
  CodexMode,
  InstallAuth,
  isValidEnvironmentName,
  normalizeOrigin,
  type CodexMode as CodexModeValue,
  type InstallAuth as InstallAuthValue,
} from './install-intent'
import type { PathEnv } from './paths'

export const LaunchConfigSchemaVersion = 1 as const
export type LaunchConfigSchemaVersion = typeof LaunchConfigSchemaVersion

export type LaunchClientState = {
  readonly gatewayOrigin: string
  readonly auth: InstallAuthValue
  readonly authEnv: string
}

export type OpenCodeLaunchState = LaunchClientState & {
  readonly configPath: string
}

export type CodexLaunchState = LaunchClientState & {
  readonly configPath: string
  readonly codexMode: CodexModeValue
}

export type ClaudeLaunchState = LaunchClientState

export type LaunchConfig = {
  readonly schemaVersion: LaunchConfigSchemaVersion
  readonly openCode?: OpenCodeLaunchState
  readonly codex?: CodexLaunchState
  readonly claude: ClaudeLaunchState
}

export type LaunchConfigEnvironment = PathEnv

export class LaunchConfigError extends Error {
  readonly name = 'LaunchConfigError'
}

export const MULTIPLE_SSO_ORIGINS_ERROR =
  'multiple distinct SSO gateway origins are configured; one stored SSO token can serve only one origin'

export function validateLaunchAuthEnvironment(value: string): void {
  if (!isValidEnvironmentName(value)) {
    throw new LaunchConfigError(
      'The configured LiteLLM auth environment name is invalid; use a shell-compatible variable name.',
    )
  }
}

export function validateLaunchConfig(config: LaunchConfig): void {
  parseLaunchConfig(config)
}

export function parseLaunchConfig(value: unknown): LaunchConfig {
  if (!isRecord(value)) throw new Error('not an object')
  requireExactKeys(value, ['schemaVersion', 'openCode', 'codex', 'claude'], [
    'schemaVersion',
    'claude',
  ])

  if (value.schemaVersion !== LaunchConfigSchemaVersion) {
    throw new Error('unsupported schema version')
  }

  const config: {
    schemaVersion: LaunchConfigSchemaVersion
    openCode?: OpenCodeLaunchState
    codex?: CodexLaunchState
    claude: ClaudeLaunchState
  } = {
    schemaVersion: LaunchConfigSchemaVersion,
    claude: parseClaudeState(value.claude),
  }
  if ('openCode' in value) config.openCode = parseOpenCodeState(value.openCode)
  if ('codex' in value) config.codex = parseCodexState(value.codex)
  validateSingleSsoOrigin(config)
  return config
}

function validateSingleSsoOrigin(config: LaunchConfig): void {
  const origins = [config.openCode, config.codex, config.claude]
    .filter((state): state is LaunchClientState => state !== undefined)
    .filter((state) => state.auth === InstallAuth.Sso)
    .map((state) => state.gatewayOrigin)
  if (new Set(origins).size > 1) throw new Error(MULTIPLE_SSO_ORIGINS_ERROR)
}

function parseOpenCodeState(value: unknown): OpenCodeLaunchState {
  const base = parseClientState(value, ['gatewayOrigin', 'auth', 'authEnv', 'configPath'])
  if (!isRecord(value) || typeof value.configPath !== 'string' || !isValidConfigPath(value.configPath)) {
    throw new Error('invalid OpenCode configuration path')
  }
  return { ...base, configPath: value.configPath }
}

function parseCodexState(value: unknown): CodexLaunchState {
  const base = parseClientState(value, ['gatewayOrigin', 'auth', 'authEnv', 'configPath', 'codexMode'])
  if (!isRecord(value) || typeof value.configPath !== 'string' || !isValidConfigPath(value.configPath)) {
    throw new Error('invalid Codex configuration path')
  }
  return { ...base, configPath: value.configPath, codexMode: parseCodexMode(value.codexMode) }
}

function parseClaudeState(value: unknown): ClaudeLaunchState {
  return parseClientState(value, ['gatewayOrigin', 'auth', 'authEnv'])
}

function parseClientState(value: unknown, keys: readonly string[]): LaunchClientState {
  if (!isRecord(value)) throw new Error('not an object')
  requireExactKeys(value, keys, keys)

  if (typeof value.gatewayOrigin !== 'string') throw new Error('invalid gateway origin')
  const normalizedOrigin = normalizeOrigin(value.gatewayOrigin)
  if (normalizedOrigin === undefined || normalizedOrigin !== value.gatewayOrigin) {
    throw new Error('gateway origin is not normalized')
  }

  const auth = parseAuth(value.auth)
  if (typeof value.authEnv !== 'string') throw new Error('invalid auth environment')
  validateLaunchAuthEnvironment(value.authEnv)
  return { gatewayOrigin: normalizedOrigin, auth, authEnv: value.authEnv }
}

function parseAuth(value: unknown): InstallAuthValue {
  switch (value) {
    case InstallAuth.Environment:
    case InstallAuth.Sso:
      return value
    default:
      throw new Error('invalid authentication mode')
  }
}

function parseCodexMode(value: unknown): CodexModeValue {
  switch (value) {
    case CodexMode.Gateway:
    case CodexMode.OAuth:
    case CodexMode.Both:
      return value
    default:
      throw new Error('invalid Codex mode')
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedKeys = new Set(allowed)
  const keys = Object.keys(value)
  if (keys.some((key) => !allowedKeys.has(key))) throw new Error('unexpected configuration fields')
  if (keys.length !== new Set(keys).size) throw new Error('duplicate configuration fields')
  if (required.some((key) => !keys.includes(key))) throw new Error('missing configuration fields')
}

function isValidConfigPath(value: string): boolean {
  return value !== '' && !/[\u0000\r\n]/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
