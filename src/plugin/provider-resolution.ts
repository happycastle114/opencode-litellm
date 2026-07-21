import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  autoDetectLiteLLM,
  normalizeBaseURL,
} from '../utils/litellm-api'
import {
  resolveSearchApiKey,
  type LiteLLMSearchEndpoint,
} from '../search/client'
import { loadOfficialLiteLLMApiKey } from '../cli/official-token'
import { resolveHeaderSafeApiKey } from '../utils/api-key'

export type PublicPluginConfig = {
  provider?: Record<string, unknown>
  mcp?: Record<string, unknown>
}

export const CHAT_PROVIDER_ID = 'litellm' as const
export const PROVIDER_NPM = '@ai-sdk/openai' as const
export const OFFICIAL_TOKEN_PATH = ['.litellm', 'token.json'] as const
export const ENV_REFERENCE_PATTERN = /^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/

export const PROVIDER_RESOLUTION = {
  Resolved: 'resolved',
  UnresolvedCredential: 'unresolved-credential',
  Unavailable: 'unavailable',
} as const

export type ProviderResolutionKind =
  (typeof PROVIDER_RESOLUTION)[keyof typeof PROVIDER_RESOLUTION]

export type ResolvedProvider = {
  readonly kind: typeof PROVIDER_RESOLUTION.Resolved
  readonly config: PublicPluginConfig
  readonly baseURL: string
  readonly apiKey: string | undefined
  readonly customHeaders: Record<string, string> | undefined
  readonly provider: Record<string, unknown>
  readonly models: Record<string, unknown>
}

export type UnresolvedProvider = {
  readonly kind: typeof PROVIDER_RESOLUTION.UnresolvedCredential
}

export type UnavailableProvider = {
  readonly kind: typeof PROVIDER_RESOLUTION.Unavailable
}

export type ProviderResolution =
  | ResolvedProvider
  | UnresolvedProvider
  | UnavailableProvider

export function normalizeApiKey(value: string | undefined): string | undefined {
  return resolveHeaderSafeApiKey(value)
}

export function readCustomHeaders(
  options: Record<string, unknown>,
): Record<string, string> | undefined {
  const raw = options.customHeaders
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return undefined
}

export async function resolveProvider(
  config: PublicPluginConfig,
): Promise<ProviderResolution> {
  const providerConfig = isRecord(config.provider) ? config.provider : {}
  if (config.provider !== providerConfig) config.provider = providerConfig

  const existingValue = providerConfig[CHAT_PROVIDER_ID]
  const existing = isRecord(existingValue) ? existingValue : undefined
  const options = existing && isRecord(existing.options) ? existing.options : {}
  const configuredBase =
    typeof options.baseURL === 'string' ? options.baseURL : undefined
  const configuredCredentialDeclared = Object.prototype.hasOwnProperty.call(
    options,
    'apiKey',
  )
  const configuredKey =
    typeof options.apiKey === 'string' ? options.apiKey : undefined
  const configuredApiKey = !configuredCredentialDeclared || configuredKey === undefined
    ? undefined
    : normalizeApiKey(resolveSearchApiKey(configuredKey))
  const officialKey = configuredBase === undefined
    ? undefined
    : normalizeApiKey(loadOfficialLiteLLMApiKey({
        tokenFilePath: join(process.env.HOME ?? homedir(), ...OFFICIAL_TOKEN_PATH),
        expectedBaseURL: normalizeBaseURL(configuredBase),
      }))
  const officialFallbackAllowed = !configuredCredentialDeclared ||
    configuredKey === '' ||
    (configuredKey !== undefined && ENV_REFERENCE_PATTERN.test(configuredKey))
  const ambientApiKey = !configuredCredentialDeclared && officialKey === undefined
    ? normalizeApiKey(resolveSearchApiKey())
    : undefined
  const apiKey = configuredApiKey ??
    (officialFallbackAllowed ? officialKey : undefined) ??
    ambientApiKey

  if (configuredCredentialDeclared && apiKey === undefined) {
    return { kind: PROVIDER_RESOLUTION.UnresolvedCredential }
  }

  const customHeaders = readCustomHeaders(options)
  const baseURL = configuredBase
    ? normalizeBaseURL(configuredBase)
    : await autoDetectLiteLLM(apiKey, customHeaders, {
        allowAmbientFallback: false,
      })
  if (!baseURL) return { kind: PROVIDER_RESOLUTION.Unavailable }

  if (!existing) {
    providerConfig[CHAT_PROVIDER_ID] = {
      npm: PROVIDER_NPM,
      name: 'LiteLLM (proxy)',
      options: { baseURL: `${baseURL}/v1` },
      models: {},
    }
  }

  const providerValue = providerConfig[CHAT_PROVIDER_ID]
  const provider = isRecord(providerValue)
    ? providerValue
    : {
        npm: PROVIDER_NPM,
        name: 'LiteLLM (proxy)',
        options: { baseURL: `${baseURL}/v1` },
        models: {},
      }
  if (providerValue !== provider) providerConfig[CHAT_PROVIDER_ID] = provider
  provider.npm = PROVIDER_NPM
  const providerOptions = isRecord(provider.options)
    ? provider.options
    : { baseURL: `${baseURL}/v1` }
  provider.options = providerOptions
  if (apiKey !== undefined) providerOptions.apiKey = apiKey
  const models = isRecord(provider.models) ? provider.models : {}
  provider.models = models

  return {
    kind: PROVIDER_RESOLUTION.Resolved,
    config,
    baseURL,
    apiKey,
    customHeaders,
    provider,
    models,
  }
}

export function toSearchEndpoint(
  provider: ResolvedProvider,
): LiteLLMSearchEndpoint {
  return {
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    customHeaders: provider.customHeaders,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
