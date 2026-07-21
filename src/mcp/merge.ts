import { mcpServerEndpoint, mcpToolsetEndpoint } from './endpoints'
import type { McpDiscoveryOptions } from './options'

type McpConfig = {
  mcp?: Record<string, unknown>
}

const MCP_ENTRY_PREFIX = {
  Server: 'litellm-',
  Toolset: 'litellm-toolset-',
} as const
const MCP_SERVER_KEY = {
  CollisionSeparator: '-',
  FirstSuffix: 2,
} as const
const TOOLSET_FALLBACK_SLUG = 'unnamed'

type McpServerEntryKey = `${typeof MCP_ENTRY_PREFIX.Server}${string}`

export type McpMergeInput = {
  readonly config: McpConfig
  readonly baseURL: string
  readonly serverNames: readonly string[]
  readonly toolsets?: readonly string[]
  readonly options: McpDiscoveryOptions
  readonly authorization: string
  readonly customHeaders?: Readonly<Record<string, string>>
}

export function mergeDiscoveredMcpServers(input: McpMergeInput): number {
  const include = new Set(input.options.include)
  const exclude = new Set(input.options.exclude)
  const enabledOverrides = new Map(
    input.options.servers
      .filter((server) => server.enabled !== undefined)
      .map((server) => [server.serverName, server.enabled] as const),
  )
  const selected = input.serverNames.filter(
    (serverName) =>
      (include.size === 0 || include.has(serverName)) && !exclude.has(serverName),
  )
  const toolsets = input.toolsets ?? []
  if (selected.length === 0 && toolsets.length === 0) return 0

  const existing = input.config.mcp ?? {}
  const headers = buildMcpHeaders(input.customHeaders, input.authorization)
  const serverKeys = buildMcpServerKeys(selected, input.baseURL, existing)
  const reservedKeys = new Set(serverKeys.values())
  let added = 0
  for (const [serverName, key] of [...serverKeys.entries()].sort(compareMcpKeyEntries)) {
    if (existing[key] !== undefined) continue
    existing[key] = {
      type: 'remote',
      url: mcpServerEndpoint(input.baseURL, serverName),
      enabled: enabledOverrides.get(serverName) ?? true,
      oauth: false,
      timeout: input.options.requestTimeoutMs,
      headers: { ...headers },
    }
    added += 1
  }
  const toolsetEntries = uniqueToolsetEntries(toolsets, reservedKeys, input.baseURL, existing)
  for (const { name: toolsetName, key } of [...toolsetEntries].sort(compareMcpKeyEntries)) {
    if (existing[key] !== undefined) continue
    existing[key] = {
      type: 'remote',
      url: mcpToolsetEndpoint(input.baseURL, toolsetName),
      enabled: true,
      oauth: false,
      timeout: input.options.requestTimeoutMs,
      headers: { ...headers },
    }
    added += 1
  }
  if (added > 0 && input.config.mcp === undefined) input.config.mcp = existing
  return added
}

function compareMcpKeyEntries(
  left: readonly [string, unknown] | { readonly key: string },
  right: readonly [string, unknown] | { readonly key: string },
): number {
  const leftKey = mcpEntryKey(left)
  const rightKey = mcpEntryKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function mcpEntryKey(value: readonly [string, unknown] | { readonly key: string }): string {
  return 'key' in value ? value.key : String(value[1])
}

function buildMcpServerKeys(
  serverNames: readonly string[],
  baseURL: string,
  existing: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, McpServerEntryKey> {
  const uniqueNames = [...new Set(serverNames)]
  const assignedKeys = new Map<string, McpServerEntryKey>()
  const usedKeys = new Set<McpServerEntryKey>(Object.keys(existing) as McpServerEntryKey[])
  const existingKeysByURL = existingMcpKeysByURL(existing)
  const orderedNames = [...uniqueNames].sort(compareMcpServerNames)
  for (const serverName of orderedNames) {
    const existingKey = existingKeysByURL.get(mcpServerEndpoint(baseURL, serverName))
    if (existingKey !== undefined) {
      assignedKeys.set(serverName, existingKey as McpServerEntryKey)
      continue
    }
    const baseKey = mcpServerBaseKey(serverName)
    let key = baseKey
    let suffix = MCP_SERVER_KEY.FirstSuffix
    while (usedKeys.has(key)) {
      key = `${baseKey}${MCP_SERVER_KEY.CollisionSeparator}${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    assignedKeys.set(serverName, key)
  }
  return assignedKeys
}

function mcpServerBaseKey(serverName: string): McpServerEntryKey {
  return `${MCP_ENTRY_PREFIX.Server}${serverName.replaceAll('_', '-')}`
}

function compareMcpServerNames(left: string, right: string): number {
  const leftKey = mcpServerBaseKey(left)
  const rightKey = mcpServerBaseKey(right)
  if (leftKey < rightKey) return -1
  if (leftKey > rightKey) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function buildMcpHeaders(
  customHeaders: Readonly<Record<string, string>> | undefined,
  authorization: string,
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      const normalizedName = name.toLowerCase()
      if (normalizedName === 'authorization' || normalizedName === 'content-type') continue
      headers[name] = value
    }
  }
  headers.Authorization = authorization
  return headers
}

type McpToolsetEntry = {
  readonly name: string
  readonly key: string
}

function uniqueToolsetEntries(
  names: readonly string[],
  reservedKeys: ReadonlySet<string> = new Set(),
  baseURL?: string,
  existing: Readonly<Record<string, unknown>> = {},
): readonly McpToolsetEntry[] {
  const usedKeys = new Set(reservedKeys)
  for (const key of Object.keys(existing)) usedKeys.add(key)
  const existingKeysByURL = existingMcpKeysByURL(existing)
  const entries: McpToolsetEntry[] = []
  const uniqueNames = [...new Set(names.map((rawName) => rawName.trim()))]
    .filter((name) => name !== '')
  const namesBySlug = groupToolsetNames(uniqueNames)
  const canonicalKeys = new Set(
    [...namesBySlug.keys()].map((slug) => `${MCP_ENTRY_PREFIX.Toolset}${slug}`),
  )
  for (const slug of namesBySlug.keys()) {
    const group = namesBySlug.get(slug) ?? []
    const orderedGroup = hasToolsetSuffixCollision(slug, namesBySlug)
      ? [...group].sort(compareMcpToolsetNames)
      : group
    for (const name of orderedGroup) {
      const endpoint = baseURL === undefined ? undefined : mcpToolsetEndpoint(baseURL, name)
      const existingKey = endpoint === undefined ? undefined : existingKeysByURL.get(endpoint)
      if (existingKey !== undefined) {
        usedKeys.add(existingKey)
        entries.push({ name, key: existingKey })
        continue
      }
      let suffix = 0
      let key = `${MCP_ENTRY_PREFIX.Toolset}${slug}`
      while (
        usedKeys.has(key) ||
        (key !== `${MCP_ENTRY_PREFIX.Toolset}${slug}` && canonicalKeys.has(key))
      ) {
        suffix += 1
        key = `${MCP_ENTRY_PREFIX.Toolset}${slug}-${suffix + 1}`
      }
      usedKeys.add(key)
      entries.push({ name, key })
    }
  }
  return entries
}

function groupToolsetNames(names: readonly string[]): ReadonlyMap<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const slug = normalizeToolsetSlug(name)
    const group = groups.get(slug) ?? []
    group.push(name)
    groups.set(slug, group)
  }
  return groups
}

function hasToolsetSuffixCollision(
  slug: string,
  groups: ReadonlyMap<string, readonly string[]>,
): boolean {
  for (const otherSlug of groups.keys()) {
    if (otherSlug === slug || !otherSlug.startsWith(`${slug}-`)) continue
    if (/^[0-9]+$/.test(otherSlug.slice(slug.length + 1))) return true
  }
  return false
}

function existingMcpKeysByURL(
  existing: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const keysByURL = new Map<string, string>()
  for (const [key, value] of Object.entries(existing)) {
    if (!isMcpEntry(value) || value.url === undefined) continue
    keysByURL.set(value.url, key)
  }
  return keysByURL
}

function isMcpEntry(value: unknown): value is { readonly url: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'url' in value &&
    typeof value.url === 'string'
  )
}

function compareMcpToolsetNames(left: string, right: string): number {
  const leftSlug = normalizeToolsetSlug(left)
  const rightSlug = normalizeToolsetSlug(right)
  if (leftSlug < rightSlug) return -1
  if (leftSlug > rightSlug) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeToolsetSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? TOOLSET_FALLBACK_SLUG : slug
}
