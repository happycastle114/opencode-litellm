import { normalizeBaseURL } from '../utils/litellm-api'
import { resolveHeaderSafeApiKey } from '../utils/api-key'

const ENV_PLACEHOLDER_PATTERN = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/

export type LiteLLMSearchEndpoint = {
  readonly baseURL: string
  readonly apiKey?: string
  readonly customHeaders?: Readonly<Record<string, string>>
}

export type LiteLLMSearchRequest = {
  readonly query: string
  readonly max_results: number
  readonly search_domain_filter?: readonly string[]
}

export type LiteLLMSearchResult = {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly date: string | null
  readonly last_updated: string | null
}

export type LiteLLMSearchResponse = {
  readonly object: 'search'
  readonly results: readonly LiteLLMSearchResult[]
}

export type LiteLLMSearchInvocation = {
  readonly endpoint: LiteLLMSearchEndpoint
  readonly searchToolName: string
  readonly request: LiteLLMSearchRequest
  readonly signal: AbortSignal
}

export class LiteLLMSearchError extends Error {
  readonly name = 'LiteLLMSearchError'
}

export function resolveSearchApiKey(configuredKey?: string): string | undefined {
  if (configuredKey !== undefined) {
    const placeholder = ENV_PLACEHOLDER_PATTERN.exec(configuredKey)
    const variableName = placeholder?.[1]
    if (variableName !== undefined) return resolveHeaderSafeApiKey(process.env[variableName])
    if (configuredKey.includes('{') || configuredKey.includes('}')) return undefined
    return resolveHeaderSafeApiKey(configuredKey)
  }

  const standardKey =
    process.env.OPENCODE_LITELLM_API_KEY ??
    process.env.LITELLM_API_KEY ??
    process.env.LITELLM_MASTER_KEY
  return resolveHeaderSafeApiKey(standardKey)
}

export async function searchLiteLLM(
  invocation: LiteLLMSearchInvocation,
): Promise<LiteLLMSearchResponse> {
  const { endpoint, searchToolName, request, signal } = invocation
  const apiKey = resolveHeaderSafeApiKey(endpoint.apiKey)
  if (apiKey === undefined) {
    throw new LiteLLMSearchError('LiteLLM search API key is not configured')
  }

  let response: Response
  try {
    const headers = new Headers(endpoint.customHeaders)
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('Content-Type', 'application/json')
    response = await fetch(buildSearchURL(endpoint.baseURL, searchToolName), {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new LiteLLMSearchError('LiteLLM search request was aborted')
    }
    throw new LiteLLMSearchError('LiteLLM search network request failed')
  }

  if (!response.ok) {
    throw new LiteLLMSearchError(
      `LiteLLM search responded with HTTP ${response.status}`,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new LiteLLMSearchError('LiteLLM search returned malformed JSON')
  }

  return parseSearchResponse(raw)
}

function buildSearchURL(baseURL: string, searchToolName: string): string {
  return `${normalizeBaseURL(baseURL)}/v1/search/${encodeURIComponent(searchToolName)}`
}

function parseSearchResponse(value: unknown): LiteLLMSearchResponse {
  if (!isRecord(value) || value.object !== 'search' || !Array.isArray(value.results)) {
    throw new LiteLLMSearchError('LiteLLM search returned a malformed response')
  }

  const results = value.results.map((result) => parseSearchResult(result))
  return { object: 'search', results }
}

function parseSearchResult(value: unknown): LiteLLMSearchResult {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.snippet !== 'string'
  ) {
    throw new LiteLLMSearchError('LiteLLM search returned a malformed response')
  }

  const date = optionalNullableString(value.date)
  const lastUpdated = optionalNullableString(value.last_updated)

  return {
    title: value.title,
    url: value.url,
    snippet: value.snippet,
    date,
    last_updated: lastUpdated,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  throw new LiteLLMSearchError('LiteLLM search returned a malformed response')
}
