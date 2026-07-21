import {
  CodexDiscoveryError,
  discoverCodexGatewayResources,
} from './codex-discovery'
import { isHeaderSafeApiKey } from '../utils/api-key'
import {
  DEFAULT_OVERALL_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  ENDPOINT,
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  MAX_TIMEOUT_MS,
  GatewayToolDiscoveryError,
  type GatewayDiscoveryWarning,
  type GatewayToolDiscoveryInput,
  type GatewayToolDiscoveryResult,
  type SearchDiscoveryResult,
} from './gateway-tool-discovery-contracts'
import { requestJson } from './gateway-tool-discovery-request'
import {
  readAuthorizedSearchToolNames,
  readAvailableSearchToolNames,
  readToolsets,
} from './gateway-tool-discovery-parsers'
import {
  availableFallbackWarning,
  optionalWarning,
} from './gateway-tool-discovery-warnings'

export {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  GatewayToolDiscoveryError,
}
export type {
  GatewayDiscoveryWarning,
  GatewayToolDiscoveryInput,
  GatewayToolDiscoveryResult,
  GatewayToolset,
} from './gateway-tool-discovery-contracts'

export async function discoverGatewayTools(
  input: GatewayToolDiscoveryInput,
): Promise<GatewayToolDiscoveryResult> {
  const apiKey = input.apiKey
  if (!isHeaderSafeApiKey(apiKey)) {
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
  const searchRequest = discoverSearchTools({
    origin,
    apiKey,
    fetcher,
    overallSignal: controller.signal,
    requestTimeoutMs,
  })
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
        ENDPOINT.SearchToolsAvailable,
        searchResult.reason,
      ))
    } else if (searchResult.value.warning !== undefined) {
      warnings.push(searchResult.value.warning)
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
      searchToolNames: searchResult.status === 'fulfilled' ? searchResult.value.names : [],
      toolsets: toolsetResult.status === 'fulfilled' ? toolsetResult.value : [],
      warnings,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

async function discoverSearchTools(input: {
  readonly origin: string
  readonly apiKey: string
  readonly fetcher: typeof globalThis.fetch
  readonly overallSignal: AbortSignal
  readonly requestTimeoutMs: number
}): Promise<SearchDiscoveryResult> {
  try {
    const payload = await requestJson(
      `${input.origin}${ENDPOINT.SearchToolsAuthorized}`,
      ENDPOINT.SearchToolsAuthorized,
      input.apiKey,
      input.fetcher,
      input.overallSignal,
      input.requestTimeoutMs,
    )
    return { names: readAuthorizedSearchToolNames(payload) }
  } catch {
    const payload = await requestJson(
      `${input.origin}${ENDPOINT.SearchToolsAvailable}`,
      ENDPOINT.SearchToolsAvailable,
      input.apiKey,
      input.fetcher,
      input.overallSignal,
      input.requestTimeoutMs,
    )
    return {
      names: readAvailableSearchToolNames(payload),
      warning: availableFallbackWarning(),
    }
  }
}

function coreFailure(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new CodexDiscoveryError('LiteLLM model discovery request failed.')
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), maximum)
}
