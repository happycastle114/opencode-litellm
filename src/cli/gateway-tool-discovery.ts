import {
  CodexDiscoveryError,
  discoverCodexGatewayResources,
  type CodexDiscoveryModel,
} from './codex-discovery'

const ENDPOINT = {
  McpServers: '/v1/mcp/server',
  SearchTools: '/search_tools/list',
  Toolsets: '/v1/mcp/toolset',
} as const

const RESPONSE_FIELD = {
  LitellmParams: 'litellm_params',
  SearchTools: 'search_tools',
  SearchToolName: 'search_tool_name',
  ToolsetId: 'toolset_id',
  ToolsetName: 'toolset_name',
} as const

const OPTIONAL_FAILURE_KIND = {
  InvalidJson: 'invalid_json',
  InvalidShape: 'invalid_shape',
  Request: 'request',
  Status: 'status',
  TimedOut: 'timed_out',
} as const

export const GATEWAY_DISCOVERY_RESOURCE = {
  McpServers: 'mcp_servers',
  SearchTools: 'search_tools',
  Toolsets: 'toolsets',
} as const

export const GATEWAY_DISCOVERY_WARNING_KIND = {
  InvalidResponse: 'invalid_response',
  TimedOut: 'timed_out',
  Unavailable: 'unavailable',
  Unsupported: 'unsupported',
} as const

const HTTP_STATUS = {
  MethodNotAllowed: 405,
  NotFound: 404,
} as const

const DEFAULT_OVERALL_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 3000
const MAX_TIMEOUT_MS = 5000

type OptionalEndpoint = typeof ENDPOINT.SearchTools | typeof ENDPOINT.Toolsets
type OptionalFailureKind = typeof OPTIONAL_FAILURE_KIND[keyof typeof OPTIONAL_FAILURE_KIND]
type GatewayDiscoveryResource = typeof GATEWAY_DISCOVERY_RESOURCE[keyof typeof GATEWAY_DISCOVERY_RESOURCE]
type GatewayDiscoveryWarningKind = typeof GATEWAY_DISCOVERY_WARNING_KIND[keyof typeof GATEWAY_DISCOVERY_WARNING_KIND]

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

export async function discoverGatewayTools(
  input: GatewayToolDiscoveryInput,
): Promise<GatewayToolDiscoveryResult> {
  const apiKey = input.apiKey
  if (apiKey.trim() === '') {
    throw new GatewayToolDiscoveryError('LiteLLM gateway tool discovery requires an API key.')
  }

  const origin = normalizeOrigin(input.origin)
  const fetcher = input.fetcher ?? input.fetch ?? globalThis.fetch
  const timeoutMs = boundedTimeout(input.timeoutMs, DEFAULT_OVERALL_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const requestTimeoutMs = boundedTimeout(
    input.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutMs,
  )
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  const coreRequest = discoverCodexGatewayResources({
    origin,
    apiKey,
    timeoutMs,
    requestTimeoutMs,
    fetcher,
  })
  const searchRequest = requestJson(
    `${origin}${ENDPOINT.SearchTools}`,
    ENDPOINT.SearchTools,
    apiKey,
    fetcher,
    controller.signal,
    requestTimeoutMs,
  ).then(readSearchToolNames)
  const toolsetRequest = requestJson(
    `${origin}${ENDPOINT.Toolsets}`,
    ENDPOINT.Toolsets,
    apiKey,
    fetcher,
    controller.signal,
    requestTimeoutMs,
  ).then(readToolsets)

  try {
    const [coreResult, searchResult, toolsetResult] = await Promise.allSettled([
      coreRequest,
      searchRequest,
      toolsetRequest,
    ])
    if (coreResult.status === 'rejected') throw coreFailure(coreResult.reason)

    const warnings: GatewayDiscoveryWarning[] = []
    if (coreResult.value.warnings.length > 0) {
      warnings.push({
        resource: GATEWAY_DISCOVERY_RESOURCE.McpServers,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint: ENDPOINT.McpServers,
      })
    }
    if (searchResult.status === 'rejected') {
      warnings.push(optionalWarning(
        GATEWAY_DISCOVERY_RESOURCE.SearchTools,
        ENDPOINT.SearchTools,
        searchResult.reason,
      ))
    }
    if (toolsetResult.status === 'rejected') {
      warnings.push(optionalWarning(
        GATEWAY_DISCOVERY_RESOURCE.Toolsets,
        ENDPOINT.Toolsets,
        toolsetResult.reason,
      ))
    }

    return {
      models: coreResult.value.models,
      mcpServerNames: coreResult.value.mcpServerNames,
      searchToolNames: searchResult.status === 'fulfilled' ? searchResult.value : [],
      toolsets: toolsetResult.status === 'fulfilled' ? toolsetResult.value : [],
      warnings,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function requestJson(
  url: string,
  endpoint: OptionalEndpoint,
  apiKey: string,
  fetcher: typeof globalThis.fetch,
  overallSignal: AbortSignal,
  requestTimeoutMs: number,
): Promise<unknown> {
  const requestController = new AbortController()
  const signal = AbortSignal.any([overallSignal, requestController.signal])
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let onOverallAbort: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    const rejectTimeout = () => {
      requestController.abort()
      reject(new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.TimedOut))
    }
    timeoutHandle = setTimeout(rejectTimeout, requestTimeoutMs)
    if (overallSignal.aborted) {
      rejectTimeout()
    } else {
      onOverallAbort = rejectTimeout
      overallSignal.addEventListener('abort', onOverallAbort, { once: true })
    }
  })
  const request = Promise.resolve().then(() => fetcher(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  }))

  return Promise.race([request, timeout])
    .then(async (response) => {
      if (!response.ok) {
        throw new OptionalEndpointFailure(
          endpoint,
          OPTIONAL_FAILURE_KIND.Status,
          response.status,
        )
      }
      try {
        return await response.json()
      } catch {
        throw new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.InvalidJson)
      }
    })
    .catch((error: unknown) => {
      if (error instanceof OptionalEndpointFailure) throw error
      throw new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.Request)
    })
    .finally(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (onOverallAbort !== undefined) {
        overallSignal.removeEventListener('abort', onOverallAbort)
      }
    })
}

class OptionalEndpointFailure extends Error {
  constructor(
    readonly endpoint: OptionalEndpoint,
    readonly kind: OptionalFailureKind,
    readonly status?: number,
  ) {
    super('Optional LiteLLM gateway discovery endpoint failed.')
    this.name = 'OptionalEndpointFailure'
  }
}

function readSearchToolNames(payload: unknown): readonly string[] {
  if (!isRecord(payload)) throw invalidShape(ENDPOINT.SearchTools)
  const rows = payload[RESPONSE_FIELD.SearchTools]
  if (!Array.isArray(rows)) throw invalidShape(ENDPOINT.SearchTools)

  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) throw invalidShape(ENDPOINT.SearchTools)
    const name = readNonEmptyString(row[RESPONSE_FIELD.SearchToolName])
    const params = row[RESPONSE_FIELD.LitellmParams]
    if (name === undefined || !isRecord(params)) throw invalidShape(ENDPOINT.SearchTools)
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function readToolsets(payload: unknown): readonly GatewayToolset[] {
  if (!Array.isArray(payload)) throw invalidShape(ENDPOINT.Toolsets)

  const toolsets: GatewayToolset[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const row of payload) {
    if (!isRecord(row)) throw invalidShape(ENDPOINT.Toolsets)
    const toolsetId = readNonEmptyString(row[RESPONSE_FIELD.ToolsetId])
    const toolsetName = readNonEmptyString(row[RESPONSE_FIELD.ToolsetName])
    if (toolsetId === undefined || toolsetName === undefined) {
      throw invalidShape(ENDPOINT.Toolsets)
    }
    if (seenIds.has(toolsetId) || seenNames.has(toolsetName)) continue
    seenIds.add(toolsetId)
    seenNames.add(toolsetName)
    toolsets.push({ toolsetId, toolsetName })
  }
  return toolsets
}

function optionalWarning(
  resource: GatewayDiscoveryResource,
  endpoint: OptionalEndpoint,
  reason: unknown,
): GatewayDiscoveryWarning {
  if (!(reason instanceof OptionalEndpointFailure)) {
    return {
      resource,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
      endpoint,
    }
  }
  if (
    endpoint === ENDPOINT.Toolsets &&
    reason.kind === OPTIONAL_FAILURE_KIND.Status &&
    (reason.status === HTTP_STATUS.NotFound || reason.status === HTTP_STATUS.MethodNotAllowed)
  ) {
    return {
      resource,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.Unsupported,
      endpoint,
      status: reason.status,
    }
  }
  switch (reason.kind) {
    case OPTIONAL_FAILURE_KIND.InvalidJson:
    case OPTIONAL_FAILURE_KIND.InvalidShape:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
        endpoint,
      }
    case OPTIONAL_FAILURE_KIND.TimedOut:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
        endpoint,
      }
    case OPTIONAL_FAILURE_KIND.Status:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint,
        status: reason.status,
      }
    case OPTIONAL_FAILURE_KIND.Request:
    default:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint,
      }
  }
}

function coreFailure(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new CodexDiscoveryError('LiteLLM model discovery request failed.')
}

function invalidShape(endpoint: OptionalEndpoint): OptionalEndpointFailure {
  return new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.InvalidShape)
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), maximum)
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
