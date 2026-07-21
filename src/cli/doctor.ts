import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { CodexProviderId } from './codex-config'
import { isManagedOpenCodePluginSpec } from './managed-plugin'
import { version as CURRENT_PACKAGE_VERSION } from '../version'

const PLUGIN_NAME = 'opencode-plugin-litellm'
const PROVIDER_NPM = '@ai-sdk/openai'
const ENV_REFERENCE = /^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_FIELD = /^(?:api[_-]?key|key|token|access[_-]?token|secret|password|authorization)$/i
const CODEX_FILE = { OAuthProfile: 'codex-oauth.config.toml', AuthHelper: ['libexec', 'litellm-auth-token.mjs'] } as const
const CODEX_VALUE = { EnvironmentProvider: 'litellm', LoginMethod: 'chatgpt', Header: 'x-litellm-api-key', OAuthPath: '/codex-oauth', WireApi: 'responses' } as const

export const CodexDoctorCheckCode = {
  Syntax: 'codex-syntax', BaseAuth: 'codex-base-auth', Helper: 'codex-auth-helper',
  BaseCatalog: 'codex-base-catalog', OAuthFile: 'codex-oauth-file',
  OAuthSyntax: 'codex-oauth-syntax', OAuthAuth: 'codex-oauth-auth',
  OAuthCatalog: 'codex-oauth-catalog', Secrets: 'codex-secrets',
} as const

export type CheckStatus = 'ok' | 'warn' | 'error'

export type DoctorCheck = {
  readonly code: string
  readonly status: CheckStatus
  readonly message: string
  readonly path: string
}

export type DoctorReport = {
  readonly status: CheckStatus
  readonly checks: readonly DoctorCheck[]
}

export type CodexDoctorOptions = { readonly oauthProfilePath?: string; readonly helperPath?: string }

export function inspectOpenCodeConfig(path: string): DoctorReport {
  const source = readSource(path)
  if (source === undefined) {
    return report(path, [check('file', 'warn', 'OpenCode config not found (not configured)', path)])
  }

  const parsed = parseSyntax(source)
  if (parsed === undefined) {
    return report(path, [check('syntax', 'error', 'OpenCode config is not valid JSONC', path)])
  }

  return report(path, [
    check('syntax', 'ok', 'Config is valid JSONC', path),
    checkPlugin(parsed, path),
    checkProvider(parsed, path),
  ])
}

export function inspectCodexConfig(path: string, options: CodexDoctorOptions = {}): DoctorReport {
  const source = readSource(path)
  if (source === undefined) {
    return report(path, [check(CodexDoctorCheckCode.Syntax, 'warn', 'Codex config not found (not configured)', path)])
  }
  const config = parseTomlRecord(source)
  if (config === undefined) {
    return report(path, [check(CodexDoctorCheckCode.Syntax, 'error', 'Codex config is not valid TOML', path)])
  }

  const oauthMain = config.model_provider === CodexProviderId.CodexOAuth
  const checks: DoctorCheck[] = [
    check(CodexDoctorCheckCode.Syntax, 'ok', 'Codex config is valid TOML', path),
    oauthMain ? checkOAuthAuth(config, path) : checkBaseAuth(config, path),
    checkCatalog(config, path, CodexDoctorCheckCode.BaseCatalog),
  ]
  if (config.model_provider === CodexProviderId.GatewaySso) checks.splice(2, 0, checkHelper(config, path, options))
  const profilePath = options.oauthProfilePath ?? join(dirname(path), CODEX_FILE.OAuthProfile)
  const profileSource = readSource(profilePath)
  if (profileSource === undefined) {
    checks.push(check(CodexDoctorCheckCode.OAuthFile, 'ok', 'No secondary Codex OAuth profile is configured', profilePath))
    checks.push(checkSecrets(config, undefined, path))
    return report(path, checks)
  }
  const profile = parseTomlRecord(profileSource)
  if (profile === undefined) {
    checks.push(check(CodexDoctorCheckCode.OAuthSyntax, 'error', 'Codex OAuth profile is not valid TOML', profilePath))
    checks.push(checkSecrets(config, undefined, path))
    return report(path, checks)
  }
  checks.push(
    check(CodexDoctorCheckCode.OAuthSyntax, 'ok', 'Codex OAuth profile is valid TOML', profilePath),
    checkOAuthAuth(profile, profilePath),
    checkCatalog(profile, profilePath, CodexDoctorCheckCode.OAuthCatalog),
    checkSecrets(config, profile, path),
  )
  return report(path, checks)
}

function checkBaseAuth(config: Record<string, unknown>, path: string): DoctorCheck {
  const selected = config.model_provider
  const providers = isRecord(config.model_providers) ? config.model_providers : undefined
  const provider = providers !== undefined && typeof selected === 'string'
    ? providers[selected]
    : undefined
  if (!isRecord(provider)) return check(CodexDoctorCheckCode.BaseAuth, 'error', 'Selected Codex provider is missing', path)
  const noOAuth = provider.requires_openai_auth === undefined && provider.experimental_bearer_token === undefined
  const validEnvironment = selected === CODEX_VALUE.EnvironmentProvider &&
    isEnvName(provider.env_key) && provider.auth === undefined && provider.env_http_headers === undefined && noOAuth
  const auth = isRecord(provider.auth) ? provider.auth : undefined
  const validSso = selected === CodexProviderId.GatewaySso && auth !== undefined &&
    typeof auth.command === 'string' && isAbsolute(auth.command) && provider.env_key === undefined &&
    provider.env_http_headers === undefined && noOAuth
  return validEnvironment || validSso
    ? check(CodexDoctorCheckCode.BaseAuth, 'ok', 'Codex base provider has one environment-backed auth source', path)
    : check(CodexDoctorCheckCode.BaseAuth, 'error', 'Codex base provider authentication must use exactly one supported source', path)
}

function checkHelper(config: Record<string, unknown>, path: string, options: CodexDoctorOptions): DoctorCheck {
  const providers = isRecord(config.model_providers) ? config.model_providers : undefined
  const sso = providers?.[CodexProviderId.GatewaySso]
  const auth = isRecord(sso) && isRecord(sso.auth) ? sso.auth : undefined
  const declared = typeof auth?.command === 'string' ? auth.command : undefined
  const expected = options.helperPath ?? declared ?? join(dirname(path), ...CODEX_FILE.AuthHelper)
  const matches = declared === undefined || declared === expected
  return matches && existsSync(expected)
    ? check(CodexDoctorCheckCode.Helper, 'ok', 'Codex auth helper exists', expected)
    : check(CodexDoctorCheckCode.Helper, 'error', 'Codex auth helper is missing or does not match the configured command', expected)
}

function checkOAuthAuth(profile: Record<string, unknown>, path: string): DoctorCheck {
  const providers = isRecord(profile.model_providers) ? profile.model_providers : undefined
  const provider = providers?.[CodexProviderId.CodexOAuth]
  const headers = isRecord(provider) && isRecord(provider.env_http_headers)
    ? provider.env_http_headers
    : undefined
  const valid = profile.model_provider === CodexProviderId.CodexOAuth &&
    profile.forced_login_method === CODEX_VALUE.LoginMethod && isRecord(provider) &&
    provider.requires_openai_auth === true && provider.env_key === undefined &&
    provider.auth === undefined && provider.experimental_bearer_token === undefined &&
    typeof provider.base_url === 'string' && provider.base_url.endsWith(CODEX_VALUE.OAuthPath) &&
    provider.wire_api === CODEX_VALUE.WireApi && isEnvName(headers?.[CODEX_VALUE.Header])
  return valid
    ? check(CodexDoctorCheckCode.OAuthAuth, 'ok', 'Codex OAuth config requires ChatGPT auth and an environment-backed LiteLLM header', path)
    : check(CodexDoctorCheckCode.OAuthAuth, 'error', 'Codex OAuth config auth sources are invalid or not exclusive', path)
}

function checkCatalog(config: Record<string, unknown>, ownerPath: string, code: string): DoctorCheck {
  const path = config.model_catalog_json
  if (typeof path !== 'string') return check(code, 'error', 'Codex model catalog path is missing', ownerPath)
  const source = readSource(path)
  const catalog = source === undefined ? undefined : parseJsonRecord(source)
  const models = catalog !== undefined && Array.isArray(catalog.models) ? catalog.models : []
  const slugs = models.flatMap((model) => isRecord(model) && typeof model.slug === 'string' ? [model.slug] : [])
  const selected = config.model
  const validSelection = selected === undefined || typeof selected === 'string' && slugs.includes(selected)
  return slugs.length > 0 && validSelection
    ? check(code, 'ok', 'Codex model catalog is readable and contains the selected model', path)
    : check(code, 'error', 'Codex model catalog is missing, malformed, or does not contain the selected model', path)
}

function checkSecrets(config: Record<string, unknown>, profile: Record<string, unknown> | undefined, path: string): DoctorCheck {
  return containsPlaintextSecret(config) || profile !== undefined && containsPlaintextSecret(profile)
    ? check(CodexDoctorCheckCode.Secrets, 'error', 'Codex configuration contains a plaintext credential field', path)
    : check(CodexDoctorCheckCode.Secrets, 'ok', 'Codex configuration contains no plaintext credential fields', path)
}

function readSource(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function parseSyntax(source: string): unknown {
  const errors: ParseError[] = []
  const value = parseJsonc(source, errors, { allowTrailingComma: true })
  return errors.length > 0 ? undefined : value
}

function parseRecord(source: string, parser: (value: string) => unknown): Record<string, unknown> | undefined {
  try {
    const parsed = parser(source)
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

function parseTomlRecord(source: string): Record<string, unknown> | undefined { return parseRecord(source, parseToml) }

function parseJsonRecord(source: string): Record<string, unknown> | undefined { return parseRecord(source, JSON.parse) }

function isEnvName(value: unknown): value is string {
  return typeof value === 'string' && ENV_NAME.test(value)
}

function containsPlaintextSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPlaintextSecret)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, entry]) =>
    SECRET_FIELD.test(key) && typeof entry === 'string' || containsPlaintextSecret(entry),
  )
}

function checkPlugin(config: unknown, path: string): DoctorCheck {
  const plugin = isRecord(config) && Array.isArray(config.plugin) ? config.plugin : []
  const specs = plugin.map((entry) => (typeof entry === 'string' ? entry : firstOf(entry)))
  const litellm = specs.filter(
    (spec): spec is string =>
      typeof spec === 'string' &&
      (spec.startsWith(`${PLUGIN_NAME}@`) || isManagedOpenCodePluginSpec(spec)),
  )
  if (litellm.length === 0) {
    return check('plugin', 'error', 'No opencode-plugin-litellm entry found', path)
  }
  const managed = litellm.find(isManagedOpenCodePluginSpec)
  if (managed !== undefined) {
    return check('plugin', 'ok', `Plugin uses managed checkout ${managed}`, path)
  }
  const expected = `${PLUGIN_NAME}@${CURRENT_PACKAGE_VERSION}`
  if (!litellm.includes(expected)) {
    return check('plugin', 'warn', `Legacy plugin is pinned to a different version than ${expected}`, path)
  }
  return check('plugin', 'warn', `Legacy registry plugin ${expected} is configured`, path)
}

function checkProvider(config: unknown, path: string): DoctorCheck {
  const provider = isRecord(config) && isRecord(config.provider) ? config.provider.litellm : undefined
  if (!isRecord(provider)) {
    return check('provider', 'error', 'provider.litellm is not configured', path)
  }
  if (provider.npm !== PROVIDER_NPM) {
    return check('provider', 'error', `provider.litellm.npm must be ${PROVIDER_NPM}`, path)
  }
  const options = isRecord(provider.options) ? provider.options : undefined
  if (options === undefined) {
    return check('provider', 'error', 'provider.litellm.options is missing', path)
  }
  if (typeof options.baseURL !== 'string' || !options.baseURL.endsWith('/v1')) {
    return check('provider', 'error', 'provider.litellm.options.baseURL must end with /v1', path)
  }
  if (
    options.apiKey !== undefined &&
    (typeof options.apiKey !== 'string' || !ENV_REFERENCE.test(options.apiKey))
  ) {
    return check(
      'provider',
      'error',
      'provider.litellm.options.apiKey must be absent or an {env:NAME} reference',
      path,
    )
  }
  return check('provider', 'ok', 'provider.litellm shape is valid', path)
}

function firstOf(entry: unknown): unknown {
  return Array.isArray(entry) ? entry[0] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function check(code: string, status: CheckStatus, message: string, path: string): DoctorCheck {
  return { code, status, message, path }
}

function report(_path: string, checks: readonly DoctorCheck[]): DoctorReport {
  const status = checks.some((c) => c.status === 'error')
    ? 'error'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok'
  return { status, checks }
}
