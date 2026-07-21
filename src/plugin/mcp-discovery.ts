import {
  discoverLiteLLMMcpServers,
} from '../mcp/client'
import { mergeDiscoveredMcpServers } from '../mcp/merge'
import type {
  McpDiscoveryOptions,
} from '../mcp/options'

const AUTHORIZATION_PREFIX = 'Bearer '

export type McpDiscoveryConfig = {
  mcp?: Record<string, unknown>
}

export type McpDiscoveryInput = {
  readonly config: McpDiscoveryConfig
  readonly baseURL: string
  readonly apiKey: string | undefined
  readonly customHeaders: Record<string, string> | undefined
  readonly options: McpDiscoveryOptions
  readonly toolsets: readonly string[]
  readonly signal: AbortSignal
}

export async function discoverAndMergeMcpServers(
  input: McpDiscoveryInput,
): Promise<void> {
  if (!input.options.enabled && input.toolsets.length === 0) return
  const authorization = input.apiKey === undefined
    ? undefined
    : `${AUTHORIZATION_PREFIX}${input.apiKey}`
  if (authorization === undefined) {
    console.warn(
      '[opencode-litellm] MCP discovery requires a resolvable environment credential.',
    )
    return
  }

  try {
    const serverNames = input.options.enabled
      ? await discoverLiteLLMMcpServers({
          baseURL: input.baseURL,
          apiKey: input.apiKey,
          customHeaders: input.customHeaders,
          timeoutMs: input.options.timeoutMs,
          signal: input.signal,
        })
      : []
    mergeDiscoveredMcpServers({
      config: input.config,
      baseURL: input.baseURL,
      serverNames,
      toolsets: input.toolsets,
      options: input.options,
      authorization,
      customHeaders: input.customHeaders,
    })
  } catch (error) {
    console.warn(
      '[opencode-litellm] MCP discovery failed:',
      error instanceof Error ? error.message : String(error),
    )
  }
}
