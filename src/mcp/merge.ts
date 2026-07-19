import type { Config } from '@opencode-ai/plugin'
import type { McpDiscoveryOptions } from './options'

export type McpMergeInput = {
  readonly config: Config
  readonly baseURL: string
  readonly serverNames: readonly string[]
  readonly options: McpDiscoveryOptions
  readonly authorization: string
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
  if (selected.length === 0) return 0

  const existing = input.config.mcp ?? {}
  let added = 0
  for (const serverName of selected) {
    const key = `litellm-${serverName.replaceAll('_', '-')}`
    if (existing[key] !== undefined) continue
    existing[key] = {
      type: 'remote',
      url: `${input.baseURL}/${serverName}/mcp`,
      enabled: enabledOverrides.get(serverName) ?? true,
      oauth: false,
      timeout: input.options.requestTimeoutMs,
      headers: { Authorization: input.authorization },
    }
    added += 1
  }
  if (added > 0 && input.config.mcp === undefined) input.config.mcp = existing
  return added
}
