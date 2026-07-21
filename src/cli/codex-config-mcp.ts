import { mcpServerEndpoint, mcpToolsetEndpoint } from '../mcp/endpoints'

const MCP_ENTRY_KEY = {
  ServerPrefix: 'litellm_',
  ToolsetPrefix: 'litellm_toolset_',
  CollisionSeparator: '_',
  FirstSuffix: 2,
} as const

type McpServerId = `${typeof MCP_ENTRY_KEY.ServerPrefix}${string}`

export type McpRenderIntent = {
  readonly mcp?: readonly string[]
  readonly disableMcp?: readonly string[]
  readonly toolsets?: readonly string[]
}

export function renderMcpSections(
  origin: string,
  authEnv: string,
  intent: McpRenderIntent,
  reservedIds: ReadonlySet<string> = new Set(),
): readonly string[] {
  const serverNames = uniqueNames(intent.mcp ?? [])
  const serverIds = buildMcpServerIds(serverNames, reservedIds)
  const serverSections = [...serverNames].sort((left, right) => {
    const leftId = serverIds.get(left) ?? ''
    const rightId = serverIds.get(right) ?? ''
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  }).map((name) => renderMcp(
      serverIds.get(name) as McpServerId,
      mcpServerEndpoint(origin, name),
      authEnv,
      (intent.disableMcp ?? []).includes(name),
    ))
  const toolsetSections = [...uniqueToolsetEntries(
    intent.toolsets ?? [],
    new Set([...reservedIds, ...serverIds.values()]),
  )]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  .map(({ name, id }) => renderMcp(
      `${MCP_ENTRY_KEY.ToolsetPrefix}${id}`,
      mcpToolsetEndpoint(origin, name),
      authEnv,
      false,
    ))
  return [...serverSections, ...toolsetSections]
}

function uniqueNames(names: readonly string[]): readonly string[] {
  return [...new Set(names)]
}

function buildMcpServerIds(
  names: readonly string[],
  reservedIds: ReadonlySet<string>,
): ReadonlyMap<string, McpServerId> {
  const assigned = new Map<string, McpServerId>()
  const used = new Set<string>(reservedIds)
  const orderedNames = [...names].sort(compareMcpServerNames)
  for (const name of orderedNames) {
    const baseId = mcpServerBaseId(name)
    let id = baseId
    let suffix = MCP_ENTRY_KEY.FirstSuffix
    while (used.has(id)) {
      id = `${baseId}${MCP_ENTRY_KEY.CollisionSeparator}${suffix}`
      suffix += 1
    }
    used.add(id)
    assigned.set(name, id)
  }
  return assigned
}

function mcpServerBaseId(name: string): McpServerId {
  return `${MCP_ENTRY_KEY.ServerPrefix}${name.replaceAll('-', '_')}`
}

function compareMcpServerNames(left: string, right: string): number {
  const leftId = mcpServerBaseId(left)
  const rightId = mcpServerBaseId(right)
  if (leftId < rightId) return -1
  if (leftId > rightId) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

type ToolsetEntry = {
  readonly name: string
  readonly id: string
}

function uniqueToolsetEntries(
  names: readonly string[],
  reservedIds: ReadonlySet<string> = new Set(),
): readonly ToolsetEntry[] {
  const nextSuffix = new Map<string, number>()
  const usedIds = new Set(reservedIds)
  const entries: ToolsetEntry[] = []
  const uniqueNames = [...new Set(names.map((rawName) => rawName.trim()))]
    .filter((name) => name !== '')
    .sort(compareMcpToolsetNames)
  for (const name of uniqueNames) {
    const baseId = normalizeToolsetId(name)
    let suffix = nextSuffix.get(baseId) ?? 0
    let id = suffix === 0 ? baseId : `${baseId}_${suffix + 1}`
    while (usedIds.has(`${MCP_ENTRY_KEY.ToolsetPrefix}${id}`)) {
      suffix += 1
      id = `${baseId}_${suffix + 1}`
    }
    nextSuffix.set(baseId, suffix + 1)
    usedIds.add(`${MCP_ENTRY_KEY.ToolsetPrefix}${id}`)
    entries.push({ name, id })
  }
  return entries
}

function compareMcpToolsetNames(left: string, right: string): number {
  const leftId = normalizeToolsetId(left)
  const rightId = normalizeToolsetId(right)
  if (leftId < rightId) return -1
  if (leftId > rightId) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeToolsetId(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized === '' ? 'unnamed' : normalized
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

function tomlString(value: string): string {
  return JSON.stringify(value)
}
