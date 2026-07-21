import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type Edit,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'
import { ConfigurationError } from './errors'
import { isManagedOpenCodePluginSpec } from './managed-plugin'
import { version as CURRENT_PACKAGE_VERSION } from '../version'
import {
  buildOpenCodeProvider,
  type OpenCodeProviderIntent,
} from './opencode-provider'

const PLUGIN_NAME = 'opencode-plugin-litellm'
const OPENAGENT_PLUGIN_NAME = 'oh-my-openagent'
const OPENAGENT_PLUGIN_VERSION = '4.19.0'
export const OH_MY_OPENAGENT_PLUGIN_SPEC = `${OPENAGENT_PLUGIN_NAME}@${OPENAGENT_PLUGIN_VERSION}`
const LEGACY_OPENAGENT_PLUGIN_NAME = 'oh-my-opencode'
const DEFAULT_SEARCH_MAX_RESULTS = 8
const PRIMARY_SEARCH_TOOL_NAME = 'litellm_search'
const SEARCH_TOOL_NAME_PREFIX = 'litellm_'
const RESERVED_SEARCH_TOOL_NAME = 'websearch'
const MANAGED_PLUGIN_OPTION_NAMES = new Set([
  'searchTools',
  'toolsets',
  'mcpDiscovery',
])
const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2 }

export type OpenCodeEditIntent = OpenCodeProviderIntent & {
  readonly mcpDiscoveryEnabled?: boolean
  readonly search: readonly string[]
  readonly mcp: readonly string[]
  readonly toolsets?: readonly string[]
  readonly disableMcp: readonly string[]
}

type SearchToolEntry = {
  readonly toolName: string
  readonly searchToolName: string
  readonly defaultMaxResults: number
}

type McpServerEntry = { readonly serverName: string; readonly enabled: boolean }

type PluginOptions = Readonly<Record<string, unknown>> & {
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
  const plugin = mergePluginList(config, intent)
  const withPlugin = applyEdits(
    source,
    modify(source, ['plugin'], plugin, { formattingOptions: FORMATTING }),
  )
  const updated = applyEdits(
    withPlugin,
    modify(withPlugin, ['provider', 'litellm'], buildOpenCodeProvider(config, intent), {
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

function mergePluginList(
  config: unknown,
  intent: OpenCodeEditIntent,
): readonly PluginSpec[] {
  const existing = readPluginList(config)
  const spec = buildPluginSpec(intent, readTupleOptions(existing, isLiteLLMEntry))
  const openAgentSpec = buildOpenAgentSpec(existing)
  const specName = pluginSpecName(spec)
  const preserved = existing.filter(
    (entry) =>
      !isLiteLLMEntry(entry) &&
      !isOpenAgentEntry(entry) &&
      pluginSpecName(entry) !== specName,
  )
  return [spec, openAgentSpec, ...preserved]
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
    pluginPackageName(spec) === PLUGIN_NAME ||
    isManagedOpenCodePluginSpec(spec)
  )
}

function isOpenAgentEntry(entry: PluginSpec): boolean {
  const packageName = pluginPackageName(typeof entry === 'string' ? entry : entry[0])
  return packageName === LEGACY_OPENAGENT_PLUGIN_NAME || packageName === OPENAGENT_PLUGIN_NAME
}

function isCurrentOpenAgentEntry(entry: PluginSpec): boolean {
  return pluginPackageName(pluginSpecName(entry)) === OPENAGENT_PLUGIN_NAME
}

function pluginPackageName(spec: string): string {
  const at = spec.indexOf('@')
  return at < 0 ? spec : spec.slice(0, at)
}

function buildPluginSpec(
  intent: OpenCodeEditIntent,
  existingOptions: Readonly<Record<string, unknown>>,
): PluginSpec {
  const spec = intent.pluginSpec ?? `${PLUGIN_NAME}@${packageVersion()}`
  const options = buildPluginOptions(intent, existingOptions)
  return options === undefined ? spec : [spec, options]
}

function buildOpenAgentSpec(existing: readonly PluginSpec[]): PluginSpec {
  const current = existing.filter(isCurrentOpenAgentEntry)
  const options = readTupleOptions(
    current.length === 0 ? existing : current,
    isOpenAgentEntry,
  )
  return Object.keys(options).length === 0
    ? OH_MY_OPENAGENT_PLUGIN_SPEC
    : [OH_MY_OPENAGENT_PLUGIN_SPEC, options]
}

function readTupleOptions(
  entries: readonly PluginSpec[],
  matches: (entry: PluginSpec) => boolean,
): Readonly<Record<string, unknown>> {
  const options: Record<string, unknown> = {}
  for (const entry of entries) {
    if (!matches(entry) || !Array.isArray(entry) || !isRecord(entry[1])) continue
    Object.assign(options, entry[1])
  }
  return options
}

function buildPluginOptions(
  intent: OpenCodeEditIntent,
  existingOptions: Readonly<Record<string, unknown>>,
): PluginOptions | undefined {
  const searchTools = buildSearchTools(intent.search)
  const toolsets = buildToolsets(intent.toolsets)
  const mcpDiscovery = buildMcpDiscovery(
    intent.mcp,
    intent.disableMcp,
    intent.mcpDiscoveryEnabled,
  )
  const preserved = Object.fromEntries(
    Object.entries(existingOptions).filter(([name]) => !MANAGED_PLUGIN_OPTION_NAMES.has(name)),
  )
  const options = {
    ...preserved,
    ...(searchTools === undefined ? {} : { searchTools }),
    ...(toolsets === undefined ? {} : { toolsets }),
    ...(mcpDiscovery === undefined ? {} : { mcpDiscovery }),
  }
  return Object.keys(options).length === 0 ? undefined : options
}

function buildToolsets(
  toolsets: readonly string[] | undefined,
): readonly string[] | undefined {
  return toolsets === undefined || toolsets.length === 0 ? undefined : [...toolsets]
}

function buildSearchTools(search: readonly string[]): readonly SearchToolEntry[] | undefined {
  if (search.length === 0) return undefined
  const usedNames = new Set([RESERVED_SEARCH_TOOL_NAME])
  return search.map((searchToolName, index) => {
    const baseName = index === 0
      ? PRIMARY_SEARCH_TOOL_NAME
      : `${SEARCH_TOOL_NAME_PREFIX}${searchToolName.replaceAll('-', '_')}`
    let toolName = baseName
    let suffix = 2
    while (usedNames.has(toolName)) {
      toolName = `${baseName}_${suffix}`
      suffix += 1
    }
    usedNames.add(toolName)
    return { toolName, searchToolName, defaultMaxResults: DEFAULT_SEARCH_MAX_RESULTS }
  })
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

function pluginSpecName(spec: PluginSpec): string {
  return typeof spec === 'string' ? spec : spec[0]
}

function packageVersion(): string {
  return CURRENT_PACKAGE_VERSION
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
