import type { CodexDiscoveryModel } from './codex-discovery-model'
import { buildOpenCodeProviderModels } from './opencode-provider-model'

const PROVIDER_NPM = {
  Chat: '@ai-sdk/openai-compatible',
  Responses: '@ai-sdk/openai',
} as const
const PROVIDER_NAME = 'LiteLLM'
const PROVIDER_FIELD = {
  Models: 'models',
  Options: 'options',
  Whitelist: 'whitelist',
} as const
const LEGACY_MANAGED_WHITELIST = [
  'alibaba-token/deepseek-v4-pro',
  'alibaba-token/glm-5.2',
  'alibaba-token/qwen3.6-flash',
  'alibaba-token/qwen3.7-max',
  'alibaba-token/qwen3.7-plus',
  'alibaba-token/qwen3.8-max-preview',
] as const
const LEGACY_MANAGED_WHITELIST_IDS: ReadonlySet<string> = new Set(
  LEGACY_MANAGED_WHITELIST,
)

export type OpenCodeProviderIntent = {
  readonly baseUrl: string
  readonly authEnv: string
  readonly pluginSpec?: string
  readonly models?: readonly CodexDiscoveryModel[]
}

export function buildOpenCodeProvider(
  config: unknown,
  intent: OpenCodeProviderIntent,
): Record<string, unknown> {
  const origin = intent.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  const provider = readLiteLLMProvider(config)
  const providerOptions = provider[PROVIDER_FIELD.Options]
  const options = isRecord(providerOptions)
    ? providerOptions
    : {}
  const discoveredModels = buildOpenCodeProviderModels(intent.models ?? [])
  const providerModels = provider[PROVIDER_FIELD.Models]
  const existingModels = isRecord(providerModels)
    ? providerModels
    : {}
  const models = { ...discoveredModels, ...existingModels }
  const preserved = isLegacyManagedWhitelist(provider[PROVIDER_FIELD.Whitelist])
    ? withoutField(provider, PROVIDER_FIELD.Whitelist)
    : provider
  return {
    ...preserved,
    npm: intent.pluginSpec === undefined ? PROVIDER_NPM.Chat : PROVIDER_NPM.Responses,
    name: PROVIDER_NAME,
    ...(Object.keys(models).length === 0 ? {} : { models }),
    options: {
      ...options,
      baseURL: `${origin}/v1`,
      apiKey: `{env:${intent.authEnv}}`,
    },
  }
}

function readLiteLLMProvider(config: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(config) || !isRecord(config.provider)) return {}
  return isRecord(config.provider.litellm) ? config.provider.litellm : {}
}

function isLegacyManagedWhitelist(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== LEGACY_MANAGED_WHITELIST.length) {
    return false
  }
  const entries = value.filter((entry): entry is string => typeof entry === 'string')
  return entries.length === LEGACY_MANAGED_WHITELIST.length &&
    new Set(entries).size === LEGACY_MANAGED_WHITELIST.length &&
    entries.every((entry) => LEGACY_MANAGED_WHITELIST_IDS.has(entry))
}

function withoutField(
  source: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== field))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
