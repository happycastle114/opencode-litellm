import { isMcpServerName } from '../mcp/options'
import { isHeaderSafeApiKey } from '../utils/api-key'
import {
  parseCodexDiscoveryModels,
  type CodexDiscoveryModel,
} from './codex-discovery-model'

export type { CodexDiscoveryModel } from './codex-discovery-model'

const ENDPOINT = { Models: '/v1/models', McpServers: '/v1/mcp/server' } as const
const RESPONSE_FIELD = { Data: 'data', McpServers: 'mcp_servers', ServerName: 'server_name' } as const
const FAILURE_KIND = { Request: 'request', Status: 'status', Json: 'json', Shape: 'shape' } as const
type FailureKind = typeof FAILURE_KIND[keyof typeof FAILURE_KIND]
const DEFAULT_OVERALL_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 3000
const MAX_OVERALL_TIMEOUT_MS = 5000

export type CodexGatewayDiscoveryInput = { readonly origin: string; readonly apiKey: string; readonly timeoutMs?: number; readonly requestTimeoutMs?: number; readonly fetch?: typeof globalThis.fetch; readonly fetcher?: typeof globalThis.fetch }

export type CodexGatewayDiscoveryResult = { readonly models: readonly CodexDiscoveryModel[]; readonly mcpServerNames: readonly string[]; readonly warnings: readonly string[] }

export class CodexDiscoveryError extends Error {
  readonly name = 'CodexDiscoveryError'

  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export function discoverCodexGatewayResources(
  input: CodexGatewayDiscoveryInput,
): Promise<CodexGatewayDiscoveryResult>
export function discoverCodexGatewayResources(
  origin: string,
  apiKey: string,
  options?: Omit<CodexGatewayDiscoveryInput, 'origin' | 'apiKey'>,
): Promise<CodexGatewayDiscoveryResult>
export async function discoverCodexGatewayResources(
  inputOrOrigin: CodexGatewayDiscoveryInput | string,
  maybeApiKey?: string,
  maybeOptions: Omit<CodexGatewayDiscoveryInput, 'origin' | 'apiKey'> = {},
): Promise<CodexGatewayDiscoveryResult> {
  const input = typeof inputOrOrigin === 'string'
    ? { ...maybeOptions, origin: inputOrOrigin, apiKey: maybeApiKey ?? '' }
    : inputOrOrigin
  if (!isHeaderSafeApiKey(input.apiKey)) {
    throw new CodexDiscoveryError('LiteLLM Codex discovery requires an API key.')
  }
  const origin = normalizeOrigin(input.origin)
  const fetcher = input.fetcher ?? input.fetch ?? globalThis.fetch
  const overallTimeoutMs = boundedTimeout(input.timeoutMs, DEFAULT_OVERALL_TIMEOUT_MS, MAX_OVERALL_TIMEOUT_MS)
  const requestTimeoutMs = boundedTimeout(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, overallTimeoutMs)
  const overallController = new AbortController()
  const overallTimer = setTimeout(() => overallController.abort(), overallTimeoutMs)
  const modelRequest = requestJson(
    `${origin}${ENDPOINT.Models}`, ENDPOINT.Models, input.apiKey, fetcher,
    overallController.signal, requestTimeoutMs,
  ).then(readModels)
  const mcpRequest = requestJson(
    `${origin}${ENDPOINT.McpServers}`, ENDPOINT.McpServers, input.apiKey, fetcher,
    overallController.signal, requestTimeoutMs,
  ).then(readMcpServerNames)
  try {
    const [modelResult, mcpResult] = await Promise.allSettled([modelRequest, mcpRequest])
    if (modelResult.status === 'rejected') throw modelDiscoveryError(modelResult.reason)
    if (mcpResult.status === 'rejected') {
      return { models: modelResult.value, mcpServerNames: [], warnings: [mcpWarning(mcpResult.reason)] }
    }
    return { models: modelResult.value, mcpServerNames: mcpResult.value, warnings: [] }
  } finally {
    clearTimeout(overallTimer)
  }
}

function requestJson(
  url: string,
  endpoint: typeof ENDPOINT[keyof typeof ENDPOINT],
  apiKey: string,
  fetcher: typeof globalThis.fetch,
  overallSignal: AbortSignal,
  requestTimeoutMs: number,
): Promise<unknown> {
  const requestController = new AbortController()
  const signal = AbortSignal.any([overallSignal, requestController.signal])
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      requestController.abort()
      reject(new EndpointFailure(endpoint, FAILURE_KIND.Request))
    }, requestTimeoutMs)
    if (signal.aborted) {
      requestController.abort()
      reject(new EndpointFailure(endpoint, FAILURE_KIND.Request))
    } else {
      onAbort = () => {
        requestController.abort()
        reject(new EndpointFailure(endpoint, FAILURE_KIND.Request))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  const request = Promise.resolve().then(() => fetcher(url, {
    method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal,
  }))
  return Promise.race([request, timeout])
    .then(async (response) => {
      if (!response.ok) throw new EndpointFailure(endpoint, FAILURE_KIND.Status, response.status)
      try {
        return await response.json()
      } catch {
        throw new EndpointFailure(endpoint, FAILURE_KIND.Json)
      }
    })
    .catch((error: unknown) => {
      if (error instanceof EndpointFailure) throw error
      throw new EndpointFailure(endpoint, FAILURE_KIND.Request)
    })
    .finally(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    })
}

class EndpointFailure extends Error {
  constructor(
    readonly endpoint: typeof ENDPOINT[keyof typeof ENDPOINT],
    readonly kind: FailureKind,
    readonly status?: number,
  ) {
    super('Codex discovery endpoint failed.')
    this.name = 'EndpointFailure'
  }
}

function readModels(payload: unknown): readonly CodexDiscoveryModel[] {
  const models = parseCodexDiscoveryModels(payload)
  if (models === undefined) throw new EndpointFailure(ENDPOINT.Models, FAILURE_KIND.Shape)
  return models
}

function readMcpServerNames(payload: unknown): readonly string[] {
  const rows = readRows(payload)
  if (rows === undefined) throw new EndpointFailure(ENDPOINT.McpServers, FAILURE_KIND.Shape)
  const names: string[] = []
  const seen = new Set<string>()
  let invalidRows = 0
  for (const row of rows) {
    if (!isRecord(row)) { invalidRows += 1; continue }
    const nameValue = row[RESPONSE_FIELD.ServerName]
    if (typeof nameValue !== 'string') { invalidRows += 1; continue }
    const name = nameValue.trim()
    if (name === '' || !isMcpServerName(name)) { invalidRows += 1; continue }
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (rows.length > 0 && names.length === 0 && invalidRows > 0) {
    throw new EndpointFailure(ENDPOINT.McpServers, FAILURE_KIND.Shape)
  }
  return names
}

function modelDiscoveryError(reason: unknown): CodexDiscoveryError {
  if (reason instanceof EndpointFailure) {
    switch (reason.kind) {
      case FAILURE_KIND.Status:
        return new CodexDiscoveryError(`LiteLLM model discovery responded with HTTP ${reason.status ?? 0}.`, reason.status)
      case FAILURE_KIND.Json:
        return new CodexDiscoveryError('LiteLLM model discovery returned malformed JSON.')
      case FAILURE_KIND.Shape:
        return new CodexDiscoveryError('LiteLLM model discovery returned an invalid or empty catalog.')
      case FAILURE_KIND.Request:
        return new CodexDiscoveryError('LiteLLM model discovery request failed.')
      default:
        return assertNever(reason.kind)
    }
  }
  return new CodexDiscoveryError('LiteLLM model discovery request failed.')
}

function mcpWarning(reason: unknown): string {
  if (reason instanceof EndpointFailure) {
    switch (reason.kind) {
      case FAILURE_KIND.Status:
        return `LiteLLM MCP server discovery responded with HTTP ${reason.status ?? 0}; continuing without MCP servers.`
      case FAILURE_KIND.Json:
        return 'LiteLLM MCP server discovery returned malformed JSON; continuing without MCP servers.'
      case FAILURE_KIND.Shape:
        return 'LiteLLM MCP server discovery returned an invalid response; continuing without MCP servers.'
      case FAILURE_KIND.Request:
        return 'LiteLLM MCP server discovery request failed; continuing without MCP servers.'
      default:
        return assertNever(reason.kind)
    }
  }
  return 'LiteLLM MCP server discovery request failed; continuing without MCP servers.'
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Codex discovery failure kind: ${String(value)}`)
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), maximum)
}

function readRows(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return undefined
  const data = value[RESPONSE_FIELD.Data]
  if (Array.isArray(data)) return data
  const mcpServers = value[RESPONSE_FIELD.McpServers]
  return Array.isArray(mcpServers) ? mcpServers : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
