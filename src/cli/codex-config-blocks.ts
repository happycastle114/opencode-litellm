import { isAbsolute } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import {
  manageCodexOAuthRequestCompression,
  restoreCodexRequestCompressionPreference,
} from './codex-request-compression'
import { renderMcpSections, type McpRenderIntent } from './codex-config-mcp'

const BLOCK_START = '# BEGIN opencode-litellm'
const BLOCK_END = '# END opencode-litellm'
const OAUTH_BLOCK_START = '# BEGIN opencode-litellm-oauth'
const OAUTH_BLOCK_END = '# END opencode-litellm-oauth'
const LEGACY_PROVIDER_ID = 'litellm'
const OAUTH_PROVIDER_PATH = '/codex-oauth'
const HEADER_NAME = { LiteLLMApiKey: 'x-litellm-api-key' } as const
const WIRE_API = { Responses: 'responses' } as const
const LOGIN_METHOD = { Chatgpt: 'chatgpt' } as const
const BASE_ROOT_KEYS = ['model', 'model_provider', 'model_catalog_json'] as const
const OAUTH_ONLY_ROOT_KEYS = ['forced_login_method'] as const
const OAUTH_ROOT_KEYS = [...BASE_ROOT_KEYS, ...OAUTH_ONLY_ROOT_KEYS] as const

export const CodexProviderId = {
  GatewaySso: 'litellm-gateway-sso',
  CodexOAuth: 'litellm-codex-oauth',
} as const

export type CodexProviderId = typeof CodexProviderId[keyof typeof CodexProviderId]

export type CodexConfigIntent = {
  readonly baseUrl: string
  readonly authEnv: string
  readonly authCommand?: string
  readonly includeOAuthProvider?: boolean
  readonly catalogPath: string
  readonly defaultModel: string
  readonly mcp: readonly string[]
  readonly toolsets?: readonly string[]
  readonly disableMcp: readonly string[]
}

export type CodexOAuthConfigIntent = Pick<
  CodexConfigIntent,
  'baseUrl' | 'authEnv' | 'catalogPath'
> & {
  readonly defaultModel?: string
  readonly mcp?: readonly string[]
  readonly disableMcp?: readonly string[]
  readonly toolsets?: readonly string[]
}

export function renderCodexConfig(source: string, intent: CodexConfigIntent): string {
  validateToml(source)
  const origin = normalizeOrigin(intent.baseUrl)
  const preserved = removeManagedContent(
    restoreCodexRequestCompressionPreference(source),
    OAUTH_ROOT_KEYS,
  )
  const managed = renderManagedBlock(origin, intent, readMcpServerIds(preserved))
  const output = [renderBaseRoot(intent), preserved, managed].filter((part) => part !== '').join('\n\n') + '\n'
  validateToml(output)
  return output
}

export function renderCodexOAuthConfig(intent: CodexOAuthConfigIntent): string
export function renderCodexOAuthConfig(source: string, intent: CodexOAuthConfigIntent): string
export function renderCodexOAuthConfig(
  sourceOrIntent: string | CodexOAuthConfigIntent,
  maybeIntent?: CodexOAuthConfigIntent,
): string {
  const source = typeof sourceOrIntent === 'string' ? sourceOrIntent : ''
  const intent = typeof sourceOrIntent === 'string' ? maybeIntent : sourceOrIntent
  if (intent === undefined) throw new Error('Codex OAuth configuration intent is required.')
  validateToml(source)
  const origin = normalizeOrigin(intent.baseUrl)
  const preserved = removeManagedContent(
    restoreCodexRequestCompressionPreference(source),
    OAUTH_ROOT_KEYS,
  )
  const root = renderOAuthRoot(intent)
  const managed = renderOAuthManagedBlock(origin, intent, readMcpServerIds(preserved))
  const output = manageCodexOAuthRequestCompression(
    [root, preserved, managed].filter((part) => part !== '').join('\n\n') + '\n',
  )
  validateToml(output)
  return output
}

export const renderCodexOAuthProfile = renderCodexOAuthConfig

function renderBaseRoot(intent: CodexConfigIntent): string {
  const provider = intent.authCommand === undefined ? LEGACY_PROVIDER_ID : CodexProviderId.GatewaySso
  return [
    `model = ${tomlString(intent.defaultModel)}`,
    `model_provider = ${tomlString(provider)}`,
    `model_catalog_json = ${tomlString(intent.catalogPath)}`,
  ].join('\n')
}

function renderOAuthRoot(intent: CodexOAuthConfigIntent): string {
  const lines = [
    `forced_login_method = ${tomlString(LOGIN_METHOD.Chatgpt)}`,
    `model_provider = ${tomlString(CodexProviderId.CodexOAuth)}`,
    `model_catalog_json = ${tomlString(intent.catalogPath)}`,
  ]
  if (intent.defaultModel !== undefined) lines.unshift(`model = ${tomlString(intent.defaultModel)}`)
  return lines.join('\n')
}

function renderManagedBlock(
  origin: string,
  intent: CodexConfigIntent,
  reservedMcpIds: ReadonlySet<string>,
): string {
  const sections = renderMcpSections(origin, intent.authEnv, intent, reservedMcpIds)
  return [
    BLOCK_START,
    renderGatewayProvider(origin, intent),
    ...(intent.includeOAuthProvider === false ? [] : [renderOAuthProvider(origin, intent.authEnv)]),
    ...sections,
    BLOCK_END,
  ].join('\n\n')
}

function renderGatewayProvider(origin: string, intent: CodexConfigIntent): string {
  if (intent.authCommand === undefined) {
    return [
      `[model_providers.${LEGACY_PROVIDER_ID}]`,
      'name = "LiteLLM"',
      `base_url = ${tomlString(`${origin}/v1`)}`,
      `env_key = ${tomlString(intent.authEnv)}`,
      `wire_api = ${tomlString(WIRE_API.Responses)}`,
      'supports_websockets = false',
    ].join('\n')
  }
  const authCommand = validateAuthCommand(intent.authCommand)
  return [
    `[model_providers.${CodexProviderId.GatewaySso}]`,
    'name = "LiteLLM Gateway SSO"',
    `base_url = ${tomlString(`${origin}/v1`)}`,
    `wire_api = ${tomlString(WIRE_API.Responses)}`,
    'supports_websockets = false',
    '',
    `[model_providers.${CodexProviderId.GatewaySso}.auth]`,
    `command = ${tomlString(authCommand)}`,
  ].join('\n')
}

function renderOAuthManagedBlock(
  origin: string,
  intent: CodexOAuthConfigIntent,
  reservedMcpIds: ReadonlySet<string>,
): string {
  return [
    OAUTH_BLOCK_START,
    renderOAuthProvider(origin, intent.authEnv),
    ...renderMcpSections(origin, intent.authEnv, intent, reservedMcpIds),
    OAUTH_BLOCK_END,
  ].join('\n\n')
}

function renderOAuthProvider(origin: string, authEnv: string): string {
  return [
    `[model_providers.${CodexProviderId.CodexOAuth}]`,
    'name = "LiteLLM Gateway via ChatGPT OAuth"',
    `base_url = ${tomlString(`${origin}${OAUTH_PROVIDER_PATH}`)}`,
    `wire_api = ${tomlString(WIRE_API.Responses)}`,
    'supports_websockets = false',
    'requires_openai_auth = true',
    `env_http_headers = { ${tomlString(HEADER_NAME.LiteLLMApiKey)} = ${tomlString(authEnv)} }`,
  ].join('\n')
}

function removeManagedContent(source: string, rootKeys: readonly string[]): string {
  let withoutBlocks = source
  for (const [start, end] of [[OAUTH_BLOCK_START, OAUTH_BLOCK_END], [BLOCK_START, BLOCK_END]] as const) {
    withoutBlocks = withoutBlocks.replace(
      new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}[\\t ]*(?:\\r?\\n)?`, 'g'),
      '',
    )
  }
  let beforeTable = true
  const rootKeyPattern = rootKeys.map(escapeRegex).join('|')
  return withoutBlocks.split(/\r?\n/).filter((line) => {
    if (line.trimStart().startsWith('[')) beforeTable = false
    return !beforeTable || !new RegExp(`^\\s*(?:${rootKeyPattern})\\s*=`).test(line)
  }).join('\n').trim()
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, '').replace(/\/v1$/, '')
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function validateToml(value: string): void {
  parseToml(value)
}

function readMcpServerIds(source: string): ReadonlySet<string> {
  const parsed = parseToml(source) as { mcp_servers?: unknown }
  if (
    typeof parsed.mcp_servers !== 'object' ||
    parsed.mcp_servers === null ||
    Array.isArray(parsed.mcp_servers)
  ) return new Set()
  return new Set(Object.keys(parsed.mcp_servers))
}

function validateAuthCommand(value: string): string {
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
  if (value === '' || value.includes('\n') || value.includes('\r') || (!isAbsolute(value) && !windowsAbsolute)) {
    throw new Error('Codex gateway authCommand must be a stable absolute path.')
  }
  return value
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
}
