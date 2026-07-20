import { normalizeOrigin, ToolkitDefault } from './install-intent'

const OPTION = {
  AuthEnvironment: '--auth-env',
  BaseUrl: '--base-url',
} as const
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type AuthCommandOptions = {
  readonly baseUrl: string
  readonly authEnv: string
}

export type AuthCommandOptionsResult =
  | { readonly ok: true; readonly options: AuthCommandOptions }
  | { readonly ok: false; readonly message: string }

export function parseAuthCommandOptions(
  argv: readonly string[],
): AuthCommandOptionsResult {
  const values = new Map<string, string>()
  const knownOptions = new Set<string>(Object.values(OPTION))
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (option === undefined || !knownOptions.has(option)) {
      return failure(`Unknown auth option '${option ?? ''}'.`)
    }
    if (value === undefined || value.startsWith('--')) {
      return failure(`Option '${option}' requires a value.`)
    }
    if (values.has(option)) return failure(`Option '${option}' may be specified only once.`)
    values.set(option, value)
  }
  const baseUrl = normalizeOrigin(
    values.get(OPTION.BaseUrl) ?? ToolkitDefault.GatewayOrigin,
  )
  if (baseUrl === undefined) {
    return failure(`Option '${OPTION.BaseUrl}' must be an absolute http(s) origin.`)
  }
  const authEnv = values.get(OPTION.AuthEnvironment) ?? ToolkitDefault.AuthEnvironment
  return ENVIRONMENT_NAME_PATTERN.test(authEnv)
    ? success(baseUrl, authEnv)
    : failure(`Option '${OPTION.AuthEnvironment}' must be a valid environment variable name.`)
}

function success(baseUrl: string, authEnv: string): AuthCommandOptionsResult {
  return { ok: true, options: { baseUrl, authEnv } }
}

function failure(message: string): AuthCommandOptionsResult {
  return { ok: false, message }
}
