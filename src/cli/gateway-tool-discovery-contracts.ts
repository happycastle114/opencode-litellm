import type { CodexDiscoveryModel } from './codex-discovery'

export const ENDPOINT = {
  McpServers: '/v1/mcp/server',
  SearchToolsAuthorized: '/search_tools/list',
  SearchToolsAvailable: '/v1/search/tools',
  Toolsets: '/v1/mcp/toolset',
} as const

export const RESPONSE_FIELD = {
  Data: 'data',
  Object: 'object',
  SearchTools: 'search_tools',
  SearchToolName: 'search_tool_name',
  ToolsetId: 'toolset_id',
  ToolsetName: 'toolset_name',
} as const

export const RESPONSE_OBJECT = {
  List: 'list',
} as const

export const OPTIONAL_FAILURE_KIND = {
  InvalidJson: 'invalid_json',
  InvalidShape: 'invalid_shape',
  Request: 'request',
  Status: 'status',
  TimedOut: 'timed_out',
} as const

export const HTTP_STATUS = {
  MethodNotAllowed: 405,
  NotFound: 404,
} as const

export const DEFAULT_OVERALL_TIMEOUT_MS = 5000
export const DEFAULT_REQUEST_TIMEOUT_MS = 3000
export const MAX_TIMEOUT_MS = 5000

export const GATEWAY_DISCOVERY_RESOURCE = {
  McpServers: 'mcp_servers',
  SearchTools: 'search_tools',
  Toolsets: 'toolsets',
} as const

export const GATEWAY_DISCOVERY_WARNING_KIND = {
  AvailableFallback: 'available_fallback',
  InvalidResponse: 'invalid_response',
  TimedOut: 'timed_out',
  Unavailable: 'unavailable',
  Unsupported: 'unsupported',
} as const

export type OptionalEndpoint =
  | typeof ENDPOINT.SearchToolsAuthorized
  | typeof ENDPOINT.SearchToolsAvailable
  | typeof ENDPOINT.Toolsets

export type OptionalFailureKind = typeof OPTIONAL_FAILURE_KIND[keyof typeof OPTIONAL_FAILURE_KIND]
export type GatewayDiscoveryResource = typeof GATEWAY_DISCOVERY_RESOURCE[keyof typeof GATEWAY_DISCOVERY_RESOURCE]
export type GatewayDiscoveryWarningKind = typeof GATEWAY_DISCOVERY_WARNING_KIND[keyof typeof GATEWAY_DISCOVERY_WARNING_KIND]

export type SearchDiscoveryResult = {
  readonly names: readonly string[]
  readonly warning?: GatewayDiscoveryWarning
}

export type GatewayToolset = {
  readonly toolsetId: string
  readonly toolsetName: string
}

export type GatewayDiscoveryWarning = {
  readonly resource: GatewayDiscoveryResource
  readonly kind: GatewayDiscoveryWarningKind
  readonly endpoint: string
  readonly status?: number
}

export type GatewayToolDiscoveryInput = {
  readonly origin: string
  readonly apiKey: string
  readonly timeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly fetch?: typeof globalThis.fetch
  readonly fetcher?: typeof globalThis.fetch
}

export type GatewayToolDiscoveryResult = {
  readonly models: readonly CodexDiscoveryModel[]
  readonly mcpServerNames: readonly string[]
  readonly searchToolNames: readonly string[]
  readonly toolsets: readonly GatewayToolset[]
  readonly warnings: readonly GatewayDiscoveryWarning[]
}

export class GatewayToolDiscoveryError extends Error {
  readonly name = 'GatewayToolDiscoveryError'
}

export class OptionalEndpointFailure extends Error {
  constructor(
    readonly endpoint: OptionalEndpoint,
    readonly kind: OptionalFailureKind,
    readonly status?: number,
  ) {
    super('Optional LiteLLM gateway discovery endpoint failed.')
    this.name = 'OptionalEndpointFailure'
  }
}
