import { spawnSync } from 'node:child_process'
import { isMcpServerName } from '../mcp/options'

const ENDPOINT = {
  Models: '/v1/models',
  McpServers: '/v1/mcp/server',
} as const

const CATALOG_FIELD = {
  Models: 'models',
  Slug: 'slug',
  Visibility: 'visibility',
  SupportedInApi: 'supported_in_api',
  Priority: 'priority',
} as const

const RESPONSE_FIELD = {
  Data: 'data',
  McpServers: 'mcp_servers',
  Id: 'id',
  Object: 'object',
  ServerName: 'server_name',
} as const

const CATALOG_VALUE = {
  Listed: 'list',
} as const

const CODEX_COMMAND = {
  File: 'codex',
  Debug: 'debug',
  Models: 'models',
  Bundled: '--bundled',
} as const

const FAILURE_KIND = {
  Request: 'request',
  Status: 'status',
  Json: 'json',
  Shape: 'shape',
} as const

type FailureKind = typeof FAILURE_KIND[keyof typeof FAILURE_KIND]

const DEFAULT_OVERALL_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 3000
const MAX_OVERALL_TIMEOUT_MS = 5000

export type CodexDiscoveryModel = {
  readonly id: string
  readonly object?: string
}

export type CodexGatewayDiscoveryInput = {
  readonly origin: string
  readonly apiKey: string
  readonly timeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly fetch?: typeof globalThis.fetch
  readonly fetcher?: typeof globalThis.fetch
}

export type CodexGatewayDiscoveryResult = {
  readonly models: readonly CodexDiscoveryModel[]
  readonly mcpServerNames: readonly string[]
  readonly warnings: readonly string[]
}

export type CodexSpawnResult = {
  readonly status?: number | null
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly stdout?: string | Uint8Array | null
  readonly stderr?: string | Uint8Array | null
  readonly error?: unknown
}

export type CodexSpawnBoundary = {
  readonly spawn: (
    file: string,
    args: readonly string[],
    options?: Readonly<Record<string, unknown>>,
  ) => CodexSpawnResult
}

export type BundledCodexCatalog = {
  readonly json: string
  readonly defaultModel?: string
}

export class CodexDiscoveryError extends Error {
  readonly name = 'CodexDiscoveryError'

  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export class CodexCatalogError extends Error {
  readonly name = 'CodexCatalogError'
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
  const origin = normalizeOrigin(input.origin)
  const apiKey = input.apiKey
  if (apiKey.trim() === '') {
    throw new CodexDiscoveryError('LiteLLM Codex discovery requires an API key.')
  }
  const fetcher = input.fetcher ?? input.fetch ?? globalThis.fetch
  const overallTimeoutMs = boundedTimeout(
    input.timeoutMs,
    DEFAULT_OVERALL_TIMEOUT_MS,
    MAX_OVERALL_TIMEOUT_MS,
  )
  const requestTimeoutMs = boundedTimeout(
    input.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    overallTimeoutMs,
  )
  const overallController = new AbortController()
  const overallTimer = setTimeout(() => overallController.abort(), overallTimeoutMs)

  const modelRequest = requestJson(
    `${origin}${ENDPOINT.Models}`,
    ENDPOINT.Models,
    apiKey,
    fetcher,
    overallController.signal,
    requestTimeoutMs,
  ).then(readModels)
  const mcpRequest = requestJson(
    `${origin}${ENDPOINT.McpServers}`,
    ENDPOINT.McpServers,
    apiKey,
    fetcher,
    overallController.signal,
    requestTimeoutMs,
  ).then(readMcpServerNames)

  try {
    const [modelResult, mcpResult] = await Promise.allSettled([modelRequest, mcpRequest])
    if (modelResult.status === 'rejected') throw modelDiscoveryError(modelResult.reason)

    if (mcpResult.status === 'rejected') {
      return {
        models: modelResult.value,
        mcpServerNames: [],
        warnings: [mcpWarning(mcpResult.reason)],
      }
    }

    return {
      models: modelResult.value,
      mcpServerNames: mcpResult.value,
      warnings: [],
    }
  } finally {
    clearTimeout(overallTimer)
  }
}

export function readBundledCodexCatalog(
  boundary: CodexSpawnBoundary = defaultCodexSpawnBoundary(),
): BundledCodexCatalog {
  const args = [CODEX_COMMAND.Debug, CODEX_COMMAND.Models, CODEX_COMMAND.Bundled] as const
  let result: CodexSpawnResult
  try {
    result = boundary.spawn(CODEX_COMMAND.File, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new CodexCatalogError("The Codex CLI executable 'codex' was not found on PATH.")
  }

  if (result.error !== undefined) {
    throw new CodexCatalogError("The Codex CLI executable 'codex' was not found on PATH.")
  }

  const status = result.status ?? result.exitCode
  if ((status !== undefined && status !== 0) || result.signal !== undefined && result.signal !== null) {
    throw new CodexCatalogError('Codex bundled model catalog command failed.')
  }

  const stdout = toText(result.stdout)
  if (stdout.trim() === '') throw invalidCatalog()

  let payload: unknown
  try {
    payload = JSON.parse(stdout)
  } catch {
    throw invalidCatalog()
  }
  const models = readBundledModels(payload)
  const normalized = `${JSON.stringify(payload, null, 2)}\n`
  const defaultModel = chooseBundledDefault(models)
  return defaultModel === undefined
    ? { json: normalized }
    : { json: normalized, defaultModel }
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
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
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
  const rows = readDataRows(payload)
  if (rows === undefined) throw new EndpointFailure(ENDPOINT.Models, FAILURE_KIND.Shape)

  const models: CodexDiscoveryModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const idValue = row[RESPONSE_FIELD.Id]
    if (typeof idValue !== 'string') continue
    const id = idValue.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const objectValue = row[RESPONSE_FIELD.Object]
    const object = typeof objectValue === 'string'
      ? objectValue.trim()
      : ''
    models.push(object === '' ? { id } : { id, object })
  }
  if (models.length === 0) throw new EndpointFailure(ENDPOINT.Models, FAILURE_KIND.Shape)
  return models
}

function readMcpServerNames(payload: unknown): readonly string[] {
  const rows = readRows(payload)
  if (rows === undefined) throw new EndpointFailure(ENDPOINT.McpServers, FAILURE_KIND.Shape)

  const names: string[] = []
  const seen = new Set<string>()
  let invalidRows = 0
  for (const row of rows) {
    if (!isRecord(row)) {
      invalidRows += 1
      continue
    }
    const nameValue = row[RESPONSE_FIELD.ServerName]
    if (typeof nameValue !== 'string') {
      invalidRows += 1
      continue
    }
    const name = nameValue.trim()
    if (name === '' || !isMcpServerName(name)) {
      invalidRows += 1
      continue
    }
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (rows.length > 0 && names.length === 0 && invalidRows > 0) {
    throw new EndpointFailure(ENDPOINT.McpServers, FAILURE_KIND.Shape)
  }
  return names
}

function readBundledModels(payload: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!isRecord(payload)) throw invalidCatalog()
  const modelsValue = payload[CATALOG_FIELD.Models]
  if (!Array.isArray(modelsValue) || modelsValue.length === 0) throw invalidCatalog()
  if (modelsValue.some((model) => !isRecord(model))) throw invalidCatalog()
  const models = modelsValue.filter(isRecord)
  for (const model of models) {
    const slug = model[CATALOG_FIELD.Slug]
    if (typeof slug !== 'string' || slug.trim() === '') throw invalidCatalog()
  }
  return models
}

function chooseBundledDefault(
  models: readonly Readonly<Record<string, unknown>>[],
): string | undefined {
  let selected: { slug: string; priority: number } | undefined
  for (const model of models) {
    if (
      model[CATALOG_FIELD.Visibility] !== CATALOG_VALUE.Listed ||
      model[CATALOG_FIELD.SupportedInApi] !== true ||
      typeof model[CATALOG_FIELD.Priority] !== 'number' ||
      !Number.isFinite(model[CATALOG_FIELD.Priority])
    ) continue
    const slug = model[CATALOG_FIELD.Slug]
    const priority = model[CATALOG_FIELD.Priority]
    if (typeof slug !== 'string' || typeof priority !== 'number') continue
    if (selected === undefined || priority > selected.priority) selected = { slug, priority }
  }
  return selected?.slug
}

function modelDiscoveryError(reason: unknown): CodexDiscoveryError {
  if (reason instanceof EndpointFailure) {
    switch (reason.kind) {
      case FAILURE_KIND.Status:
        return new CodexDiscoveryError(
          `LiteLLM model discovery responded with HTTP ${reason.status ?? 0}.`,
          reason.status,
        )
      case FAILURE_KIND.Json:
        return new CodexDiscoveryError('LiteLLM model discovery returned malformed JSON.')
      case FAILURE_KIND.Shape:
        return new CodexDiscoveryError('LiteLLM model discovery returned an invalid or empty catalog.')
      case FAILURE_KIND.Request:
      default:
        return new CodexDiscoveryError('LiteLLM model discovery request failed.')
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
      default:
        return 'LiteLLM MCP server discovery request failed; continuing without MCP servers.'
    }
  }
  return 'LiteLLM MCP server discovery request failed; continuing without MCP servers.'
}

function invalidCatalog(): CodexCatalogError {
  return new CodexCatalogError('Codex bundled model catalog output was invalid or empty.')
}

function defaultCodexSpawnBoundary(): CodexSpawnBoundary {
  return {
    spawn(file, args) {
      const result = spawnSync(file, [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
  }
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), maximum)
}

function readDataRows(value: unknown): readonly unknown[] | undefined {
  if (!isRecord(value)) return undefined
  const data = value[RESPONSE_FIELD.Data]
  return Array.isArray(data) ? data : undefined
}

function readRows(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return undefined
  const data = value[RESPONSE_FIELD.Data]
  if (Array.isArray(data)) return data
  const mcpServers = value[RESPONSE_FIELD.McpServers]
  if (Array.isArray(mcpServers)) return mcpServers
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toText(value: string | Uint8Array | null | undefined): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return new TextDecoder().decode(value)
}
