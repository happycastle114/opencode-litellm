import { isAbsolute } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { mcpServerEndpoint, mcpToolsetEndpoint } from '../mcp/endpoints'

const BLOCK_START = '# BEGIN opencode-litellm'
const BLOCK_END = '# END opencode-litellm'
const OAUTH_BLOCK_START = '# BEGIN opencode-litellm-oauth'
const OAUTH_BLOCK_END = '# END opencode-litellm-oauth'
const MCP_SERVER_PREFIX = 'litellm_'
const MCP_TOOLSET_PREFIX = 'litellm_toolset_'
const LEGACY_PROVIDER_ID = 'litellm'
const OAUTH_PROVIDER_PATH = '/codex-oauth'
const HEADER_NAME = {
  LiteLLMApiKey: 'x-litellm-api-key',
} as const
const WIRE_API = {
  Responses: 'responses',
} as const
const LOGIN_METHOD = {
  Chatgpt: 'chatgpt',
} as const
const CATALOG_VISIBILITY = {
  List: 'list',
} as const
const CATALOG_INPUT_MODALITY = {
  Text: 'text',
} as const
const DEFAULT_MODEL_ORDER = [
  'coding-fast',
  'student-auto-router',
  'codex/gpt-5.6',
  'coding-strong',
] as const
const BASE_ROOT_KEYS = ['model', 'model_provider', 'model_catalog_json'] as const
const OAUTH_ROOT_KEYS = [...BASE_ROOT_KEYS, 'forced_login_method'] as const

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

export type LiteLLMModel = {
  readonly id: string
  readonly object?: string
}

export type CodexCatalog = {
  readonly defaultModel: string
  readonly json: string
}

export function renderCodexConfig(source: string, intent: CodexConfigIntent): string {
  validateToml(source)
  const origin = normalizeOrigin(intent.baseUrl)
  const managed = renderManagedBlock(origin, intent)
  const preserved = removeManagedContent(source, BASE_ROOT_KEYS)
  const root = renderBaseRoot(intent)
  const output = [root, preserved, managed].filter((part) => part !== '').join('\n\n') + '\n'
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
  const preserved = removeManagedContent(source, OAUTH_ROOT_KEYS)
  const root = renderOAuthRoot(intent)
  const managed = renderOAuthManagedBlock(origin, intent)
  const output = [root, preserved, managed].filter((part) => part !== '').join('\n\n') + '\n'
  validateToml(output)
  return output
}

export const renderCodexOAuthProfile = renderCodexOAuthConfig

export function buildCodexCatalog(models: readonly LiteLLMModel[]): CodexCatalog {
  const modelIds = [...new Set(models.map((model) => model.id.trim()).filter((id) => id !== ''))].sort()
  if (modelIds.length === 0) throw new Error('LiteLLM returned no usable models for the Codex catalog.')
  const defaultModel = chooseDefaultModel(modelIds)
  const catalog = {
    models: modelIds.map((slug) => ({
      slug,
      display_name: slug,
      description: 'LiteLLM gateway model',
      visibility: CATALOG_VISIBILITY.List,
      supported_in_api: true,
      input_modalities: [CATALOG_INPUT_MODALITY.Text],
      supports_image_detail_original: false,
      supported_reasoning_levels: [],
      supports_reasoning_summaries: false,
      supports_reasoning_summary_parameter: false,
      supports_parallel_tool_calls: false,
      supports_search_tool: false,
      support_verbosity: false,
      prefer_websockets: false,
      apply_patch_tool_type: null,
      experimental_supported_tools: [],
      priority: slug === defaultModel ? 100 : 1,
    })),
  }
  return { defaultModel, json: `${JSON.stringify(catalog, null, 2)}\n` }
}

function renderBaseRoot(intent: CodexConfigIntent): string {
  const provider = intent.authCommand === undefined
    ? LEGACY_PROVIDER_ID
    : CodexProviderId.GatewaySso
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

function renderManagedBlock(origin: string, intent: CodexConfigIntent): string {
  const sections = renderMcpSections(origin, intent.authEnv, intent)
  return [
    BLOCK_START,
    renderGatewayProvider(origin, intent),
    ...(intent.includeOAuthProvider === false ? [] : [renderOAuthProvider(origin, intent.authEnv)]),
    ...sections,
    BLOCK_END,
  ].join('\n\n')
}

type McpRenderIntent = {
  readonly mcp?: readonly string[]
  readonly disableMcp?: readonly string[]
  readonly toolsets?: readonly string[]
}

function renderMcpSections(
  origin: string,
  authEnv: string,
  intent: McpRenderIntent,
): readonly string[] {
  const serverSections = (intent.mcp ?? [])
    .filter((name, index, names) => names.indexOf(name) === index)
    .map((name) => renderMcp(
      `${MCP_SERVER_PREFIX}${name.replaceAll('-', '_')}`,
      mcpServerEndpoint(origin, name),
      authEnv,
      (intent.disableMcp ?? []).includes(name),
    ))
  const toolsetSections = uniqueToolsetEntries(intent.toolsets ?? [])
    .map(({ name, id }) => renderMcp(
      `${MCP_TOOLSET_PREFIX}${id}`,
      mcpToolsetEndpoint(origin, name),
      authEnv,
      false,
    ))
  return [...serverSections, ...toolsetSections]
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
  const providerLines = [
    `[model_providers.${CodexProviderId.GatewaySso}]`,
    'name = "LiteLLM Gateway SSO"',
    `base_url = ${tomlString(`${origin}/v1`)}`,
    `wire_api = ${tomlString(WIRE_API.Responses)}`,
    'supports_websockets = false',
    '',
    `[model_providers.${CodexProviderId.GatewaySso}.auth]`,
    `command = ${tomlString(authCommand)}`,
  ]
  return providerLines.join('\n')
}

function renderOAuthManagedBlock(origin: string, intent: CodexOAuthConfigIntent): string {
  return [
    OAUTH_BLOCK_START,
    renderOAuthProvider(origin, intent.authEnv),
    ...renderMcpSections(origin, intent.authEnv, intent),
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

function renderMcp(key: string, url: string, authEnv: string, disabled: boolean): string {
  return [
    `[mcp_servers.${key}]`,
    `url = ${tomlString(url)}`,
    `bearer_token_env_var = ${tomlString(authEnv)}`,
    `enabled = ${String(!disabled)}`,
    'required = false',
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 120',
  ].join('\n')
}

type ToolsetEntry = {
  readonly name: string
  readonly id: string
}

function uniqueToolsetEntries(names: readonly string[]): readonly ToolsetEntry[] {
  const seenNames = new Set<string>()
  const nextSuffix = new Map<string, number>()
  const entries: ToolsetEntry[] = []
  for (const rawName of names) {
    const name = rawName.trim()
    if (name === '') continue
    if (seenNames.has(name)) continue
    seenNames.add(name)
    const baseId = normalizeToolsetId(name)
    const suffix = nextSuffix.get(baseId) ?? 0
    nextSuffix.set(baseId, suffix + 1)
    entries.push({
      name,
      id: suffix === 0 ? baseId : `${baseId}_${suffix + 1}`,
    })
  }
  return entries
}

function normalizeToolsetId(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized === '' ? 'unnamed' : normalized
}

function removeManagedContent(source: string, rootKeys: readonly string[]): string {
  let withoutBlocks = source
  for (const [start, end] of [
    [OAUTH_BLOCK_START, OAUTH_BLOCK_END],
    [BLOCK_START, BLOCK_END],
  ] as const) {
    withoutBlocks = withoutBlocks.replace(
      new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}[\\t ]*(?:\\r?\\n)?`, 'g'),
      '',
    )
  }

  let beforeTable = true
  const rootKeyPattern = rootKeys.map(escapeRegex).join('|')
  return withoutBlocks
    .split(/\r?\n/)
    .filter((line) => {
      if (line.trimStart().startsWith('[')) beforeTable = false
      return !beforeTable || !new RegExp(`^\\s*(?:${rootKeyPattern})\\s*=`).test(line)
    })
    .join('\n')
    .trim()
}

function chooseDefaultModel(modelIds: readonly string[]): string {
  for (const candidate of DEFAULT_MODEL_ORDER) {
    if (modelIds.includes(candidate)) return candidate
  }
  return modelIds[0] ?? unreachableCatalog()
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

function validateAuthCommand(value: string): string {
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
  if (value === '' || value.includes('\n') || value.includes('\r') || (!isAbsolute(value) && !windowsAbsolute)) {
    throw new Error('Codex gateway authCommand must be a stable absolute path.')
  }
  return value
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unreachableCatalog(): never {
  throw new Error('Codex catalog cannot select a default model from an empty list.')
}
