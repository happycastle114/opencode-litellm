import type { LiteLLMModel } from '../types'
import { resolveHeaderSafeApiKey } from './api-key'

export const DEFAULT_LITELLM_URL = 'http://localhost:4000'
const MODELS_ENDPOINT = '/v1/models'
const MODEL_GROUP_INFO_ENDPOINT = '/model_group/info'
const REQUEST_TIMEOUT_MS = 3000

export interface LiteLLMRequestOptions {
  readonly allowAmbientFallback?: boolean
}

/**
 * Normalise a base URL so the rest of the plugin can rely on a
 * predictable shape (no trailing slash, no `/v1` suffix).
 */
export function normalizeBaseURL(baseURL: string = DEFAULT_LITELLM_URL): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

/** Build a full URL for a given API endpoint. */
export function buildAPIURL(baseURL: string, endpoint: string = MODELS_ENDPOINT): string {
  return `${normalizeBaseURL(baseURL)}${endpoint}`
}

function buildHeaders(
  apiKey: string | undefined,
  customHeaders: Record<string, string> | undefined,
  options: LiteLLMRequestOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      const normalizedName = name.toLowerCase()
      if (normalizedName === 'authorization') {
        continue
      }
      if (normalizedName === 'content-type') {
        continue
      }
      headers[name] = value
    }
  }
  headers['Content-Type'] = 'application/json'
  const rawKey = apiKey ?? (
    options.allowAmbientFallback === false
      ? undefined
      : process.env.LITELLM_API_KEY ?? process.env.LITELLM_MASTER_KEY
  )
  if (rawKey !== undefined && resolveHeaderSafeApiKey(rawKey) === undefined) {
    throw new Error('LiteLLM API key contains invalid header characters.')
  }
  const key = resolveHeaderSafeApiKey(rawKey)
  if (key) {
    headers['Authorization'] = `Bearer ${key}`
  }
  return headers
}

/** Lightweight ping to see whether a LiteLLM server is reachable. */
export async function checkLiteLLMHealth(
  baseURL: string = DEFAULT_LITELLM_URL,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  options?: LiteLLMRequestOptions,
): Promise<boolean> {
  try {
    const response = await fetch(buildAPIURL(baseURL), {
      method: 'GET',
      headers: buildHeaders(apiKey, customHeaders, options),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // 401 still means a server is alive — we just don't have the right
    // credentials. Surface that as "unhealthy" so the user is prompted
    // to set LITELLM_API_KEY.
    return response.ok
  } catch {
    return false
  }
}

/** Discover all models exposed by a LiteLLM proxy. */
export async function discoverLiteLLMModels(
  baseURL: string = DEFAULT_LITELLM_URL,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  signal?: AbortSignal,
  options?: LiteLLMRequestOptions,
): Promise<LiteLLMModel[]> {
  const primary = await requestModels(
    baseURL,
    MODEL_GROUP_INFO_ENDPOINT,
    apiKey,
    customHeaders,
    parseModelGroupResponse,
    signal,
    options,
  )
  if (primary.length > 0) return primary

  return requestModels(
    baseURL,
    MODELS_ENDPOINT,
    apiKey,
    customHeaders,
    parseModelsResponse,
    signal,
    options,
  )
}

async function requestModels(
  baseURL: string,
  endpoint: string,
  apiKey: string | undefined,
  customHeaders: Record<string, string> | undefined,
  parse: (value: unknown) => LiteLLMModel[],
  signal: AbortSignal | undefined,
  options: LiteLLMRequestOptions | undefined,
): Promise<LiteLLMModel[]> {
  try {
    const response = await fetch(buildAPIURL(baseURL, endpoint), {
      method: 'GET',
      headers: buildHeaders(apiKey, customHeaders, options),
      signal:
        signal === undefined
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
    if (!response.ok) return []
    return parse(await response.json())
  } catch {
    return []
  }
}

function parseModelGroupResponse(value: unknown): LiteLLMModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return []
  return value.data.flatMap((row) => {
    if (!isRecord(row) || typeof row.model_group !== 'string') return []
    const id = row.model_group.trim()
    if (id.length === 0) return []

    const model: LiteLLMModel = { id, object: 'model' }
    copyString(row, model, 'mode')
    copyString(row, model, 'type')
    copyString(row, model, 'model_type')
    copyString(row, model, 'litellm_provider')
    copyNumber(row, model, 'max_tokens')
    copyNumber(row, model, 'max_input_tokens')
    copyNumber(row, model, 'max_output_tokens')
    copyBoolean(row, model, 'supports_function_calling')
    copyBoolean(row, model, 'supports_vision')
    return [model]
  })
}

function parseModelsResponse(value: unknown): LiteLLMModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return []
  return value.data.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') return []
    const id = row.id.trim()
    if (id.length === 0) return []
    const object = typeof row.object === 'string' ? row.object : 'model'
    const model: LiteLLMModel = { id, object }
    copyString(row, model, 'owned_by')
    copyString(row, model, 'mode')
    copyString(row, model, 'type')
    copyString(row, model, 'model_type')
    copyString(row, model, 'litellm_provider')
    copyNumber(row, model, 'created')
    copyNumber(row, model, 'max_tokens')
    copyNumber(row, model, 'max_input_tokens')
    copyNumber(row, model, 'max_output_tokens')
    copyBoolean(row, model, 'supports_function_calling')
    copyBoolean(row, model, 'supports_vision')
    return [model]
  })
}

function copyString(
  source: Readonly<Record<string, unknown>>,
  target: LiteLLMModel,
  key: 'owned_by' | 'mode' | 'type' | 'model_type' | 'litellm_provider',
): void {
  const value = source[key]
  if (typeof value === 'string') target[key] = value
}

function copyNumber(
  source: Readonly<Record<string, unknown>>,
  target: LiteLLMModel,
  key: 'created' | 'max_tokens' | 'max_input_tokens' | 'max_output_tokens',
): void {
  const value = source[key]
  if (typeof value === 'number') target[key] = value
}

function copyBoolean(
  source: Readonly<Record<string, unknown>>,
  target: LiteLLMModel,
  key: 'supports_function_calling' | 'supports_vision',
): void {
  const value = source[key]
  if (typeof value === 'boolean') target[key] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Try the most common ports a LiteLLM proxy is started on.
 * The default `litellm --port` is 4000, but 8000 is also widely used
 * and 8080 is a common reverse-proxy default.
 */
export async function autoDetectLiteLLM(
  apiKey?: string,
  customHeaders?: Record<string, string>,
  options?: LiteLLMRequestOptions,
): Promise<string | null> {
  const commonPorts = [4000, 8000, 8080]
  for (const port of commonPorts) {
    const baseURL = `http://localhost:${port}`
    if (await checkLiteLLMHealth(baseURL, apiKey, customHeaders, options)) {
      return baseURL
    }
  }
  return null
}
