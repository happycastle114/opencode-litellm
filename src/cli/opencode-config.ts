import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type Edit,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'
import { ConfigurationError } from './errors'
import { version as CURRENT_PACKAGE_VERSION } from '../version'

const PLUGIN_NAME = 'opencode-plugin-litellm'
const PROVIDER_NPM = {
  chat: '@ai-sdk/openai-compatible',
  responses: '@ai-sdk/openai',
} as const
const PROVIDER_NAME = 'LiteLLM'
const DEFAULT_SEARCH_MAX_RESULTS = 8
const MANAGED_PLUGIN_ENTRYPOINT_SUFFIX = '/opencode-litellm-git/src/index.ts'
const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2 }

export type OpenCodeEditIntent = {
  readonly baseUrl: string
  readonly authEnv: string
  readonly pluginSpec?: string
  readonly mcpDiscoveryEnabled?: boolean
  readonly search: readonly string[]
  readonly mcp: readonly string[]
  readonly toolsets?: readonly string[]
  readonly disableMcp: readonly string[]
}

type SearchToolEntry = {
  readonly toolName: string
  readonly searchToolName: string
  readonly overrideBuiltin?: boolean
  readonly defaultMaxResults: number
}

type McpServerEntry = { readonly serverName: string; readonly enabled: boolean }

type PluginOptions = {
  readonly searchTools?: readonly SearchToolEntry[]
  readonly toolsets?: readonly string[]
  readonly mcpDiscovery?: {
    readonly enabled: true
    readonly include: readonly string[]
    readonly servers: readonly McpServerEntry[]
  }
}

type PluginSpec = string | readonly [string, PluginOptions]

export function planOpenCodeEdits(
  source: string,
  intent: OpenCodeEditIntent,
  path?: string,
): readonly Edit[] {
  const config = parseValidConfig(source, path)
  const spec = buildPluginSpec(intent)
  const plugin = mergePluginList(config, spec)
  const withPlugin = applyEdits(
    source,
    modify(source, ['plugin'], plugin, { formattingOptions: FORMATTING }),
  )
  const updated = applyEdits(
    withPlugin,
    modify(withPlugin, ['provider', 'litellm'], buildProvider(intent), {
      formattingOptions: FORMATTING,
    }),
  )
  if (updated === source) return []
  return [{ offset: 0, length: source.length, content: updated }]
}

export function applyOpenCodeEdits(source: string, edits: readonly Edit[]): string {
  return applyEdits(source, [...edits])
}

function parseValidConfig(source: string, path: string | undefined): unknown {
  const errors: ParseError[] = []
  const config = parseJsonc(source, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(config)) {
    throw new ConfigurationError('OpenCode config is not valid JSONC', path)
  }
  return config
}

function mergePluginList(config: unknown, spec: PluginSpec): readonly PluginSpec[] {
  const existing = readPluginList(config)
  const specName = pluginSpecName(spec)
  const preserved = existing.filter(
    (entry) => !isLiteLLMEntry(entry) && pluginSpecName(entry) !== specName,
  )
  return [spec, ...preserved]
}

function readPluginList(config: unknown): readonly PluginSpec[] {
  if (!isRecord(config) || !Array.isArray(config.plugin)) return []
  return config.plugin.filter(isPluginSpec)
}

function isPluginSpec(entry: unknown): entry is PluginSpec {
  if (typeof entry === 'string') return true
  return Array.isArray(entry) && typeof entry[0] === 'string'
}

function isLiteLLMEntry(entry: PluginSpec): boolean {
  const spec = typeof entry === 'string' ? entry : entry[0]
  return (
    spec.startsWith(`${PLUGIN_NAME}@`) ||
    spec.endsWith(MANAGED_PLUGIN_ENTRYPOINT_SUFFIX)
  )
}

function buildPluginSpec(intent: OpenCodeEditIntent): PluginSpec {
  const spec = intent.pluginSpec ?? `${PLUGIN_NAME}@${packageVersion()}`
  const options = buildPluginOptions(intent)
  return options === undefined ? spec : [spec, options]
}

function buildPluginOptions(intent: OpenCodeEditIntent): PluginOptions | undefined {
  const searchTools = buildSearchTools(intent.search)
  const toolsets = buildToolsets(intent.toolsets)
  const mcpDiscovery = buildMcpDiscovery(
    intent.mcp,
    intent.disableMcp,
    intent.mcpDiscoveryEnabled,
  )
  if (searchTools === undefined && toolsets === undefined && mcpDiscovery === undefined) {
    return undefined
  }
  return {
    ...(searchTools === undefined ? {} : { searchTools }),
    ...(toolsets === undefined ? {} : { toolsets }),
    ...(mcpDiscovery === undefined ? {} : { mcpDiscovery }),
  }
}

function buildToolsets(
  toolsets: readonly string[] | undefined,
): readonly string[] | undefined {
  return toolsets === undefined || toolsets.length === 0 ? undefined : [...toolsets]
}

function buildSearchTools(search: readonly string[]): readonly SearchToolEntry[] | undefined {
  if (search.length === 0) return undefined
  return search.map((searchToolName, index) => ({
    toolName: index === 0 ? 'websearch' : searchToolName,
    searchToolName,
    ...(index === 0 ? { overrideBuiltin: true } : {}),
    defaultMaxResults: DEFAULT_SEARCH_MAX_RESULTS,
  }))
}

function buildMcpDiscovery(
  include: readonly string[],
  disable: readonly string[],
  enabled: boolean | undefined,
): PluginOptions['mcpDiscovery'] {
  if (enabled === false || (include.length === 0 && enabled !== true)) return undefined
  return {
    enabled: true,
    include,
    servers: disable.map((serverName) => ({ serverName, enabled: false })),
  }
}

function buildProvider(intent: OpenCodeEditIntent): Record<string, unknown> {
  const origin = intent.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return {
    npm: intent.pluginSpec === undefined ? PROVIDER_NPM.chat : PROVIDER_NPM.responses,
    name: PROVIDER_NAME,
    options: {
      baseURL: `${origin}/v1`,
      apiKey: `{env:${intent.authEnv}}`,
    },
  }
}

function pluginSpecName(spec: PluginSpec): string {
  return typeof spec === 'string' ? spec : spec[0]
}

function packageVersion(): string {
  return CURRENT_PACKAGE_VERSION
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
