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
import {
  loadEnvKey,
  loadOfficialLiteLLMApiKey,
  resolveManualLiteLLMApiKeyPath,
} from '../cli/official-token'
import { resolveHeaderSafeApiKey } from '../utils/api-key'
import { InstallAuth } from '../cli/install-intent'

export type PublicPluginConfig = {
  model?: string
  small_model?: string
  provider?: Record<string, unknown>
  mcp?: Record<string, unknown>
}

export const CHAT_PROVIDER_ID = 'litellm' as const
export const PROVIDER_NPM = '@ai-sdk/openai' as const
export const OFFICIAL_TOKEN_PATH = ['.litellm', 'token.json'] as const
export const ENV_REFERENCE_PATTERN = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/

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
  requestOptions: {
    readonly allowAmbientFallback?: boolean
    readonly auth?: InstallAuth
  } = {},
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
  const configuredVariable = configuredKey === undefined
    ? undefined
    : ENV_REFERENCE_PATTERN.exec(configuredKey)?.[1]
  const storedFallbackAllowed = !configuredCredentialDeclared || configuredKey === '' ||
    (configuredVariable !== undefined &&
      (process.env[configuredVariable] === undefined || process.env[configuredVariable] === ''))
  const configuredOrigin = configuredBase === undefined
    ? undefined
    : normalizeBaseURL(configuredBase)
  const home = process.env.HOME || homedir()
  const manualKey = requestOptions.auth !== InstallAuth.Environment ||
      configuredApiKey !== undefined || !storedFallbackAllowed || configuredOrigin === undefined
    ? undefined
    : loadEnvKey(resolveManualLiteLLMApiKeyPath({ ...process.env, HOME: home }), configuredOrigin)
  const officialKey = requestOptions.auth === InstallAuth.Environment ||
      configuredApiKey !== undefined || manualKey !== undefined ||
      !storedFallbackAllowed || configuredOrigin === undefined
    ? undefined
    : normalizeApiKey(loadOfficialLiteLLMApiKey({
        tokenFilePath: join(home, ...OFFICIAL_TOKEN_PATH),
        expectedBaseURL: configuredOrigin,
      }))
  const ambientApiKey = requestOptions.auth === undefined &&
      requestOptions.allowAmbientFallback !== false && !configuredCredentialDeclared &&
      manualKey === undefined && officialKey === undefined
    ? normalizeApiKey(resolveSearchApiKey())
    : undefined
  const apiKey = configuredApiKey ?? manualKey ?? officialKey ?? ambientApiKey

  if ((configuredCredentialDeclared || requestOptions.auth !== undefined) && apiKey === undefined) {
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
