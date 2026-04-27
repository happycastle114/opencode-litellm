import {
  autoDetectLiteLLM,
  checkLiteLLMHealth,
  discoverLiteLLMModels,
  normalizeBaseURL,
} from '../utils/litellm-api'
import {
  categorizeModel,
  extractModelOwner,
  formatModelName,
  requiresResponsesAPI,
} from '../utils/format-model-name'
import type { LiteLLMModel, Transport, TransportPolicy } from '../types'

const CHAT_PROVIDER_KEY = 'litellm'
const RESPONSES_PROVIDER_KEY = 'litellm-responses'

/**
 * Build the OpenCode model entry for a single discovered model.
 */
function buildModelEntry(model: LiteLLMModel): Record<string, unknown> {
  const owner = extractModelOwner(model)
  const type = categorizeModel(model)

  const entry: Record<string, unknown> = {
    id: model.id,
    name: formatModelName(model),
  }

  if (owner) entry.organizationOwner = owner

  switch (type) {
    case 'embedding':
      entry.modalities = { input: ['text'], output: ['embedding'] }
      break
    case 'image':
      entry.modalities = { input: ['text'], output: ['image'] }
      break
    case 'audio':
      entry.modalities = { input: ['audio', 'text'], output: ['text'] }
      break
    case 'chat':
    default:
      entry.modalities = {
        input: model.supports_vision ? ['text', 'image'] : ['text'],
        output: ['text'],
      }
      break
  }

  if (model.supports_function_calling) {
    entry.toolCall = true
  }

  return entry
}

/**
 * Sanitize an id into a key OpenCode can parse. Most LiteLLM ids are
 * already safe (`gpt-4o`, `anthropic/claude-3-5-sonnet`).
 */
function safeKey(id: string): string {
  return /^[a-zA-Z0-9/_.\-:]+$/.test(id) ? id : id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Decide which transport bucket a model belongs to. Order of
 * precedence (highest first):
 *
 *   1. Explicit allowlist `responsesApiModels`        → 'responses'
 *   2. Explicit denylist  `chatApiModels`             → 'chat'
 *   3. Global policy `transport: 'chat' | 'responses'`
 *   4. Heuristic via {@link requiresResponsesAPI}     → 'responses' or 'chat'
 */
function pickTransport(
  model: LiteLLMModel,
  policy: TransportPolicy,
  responsesApiModels: ReadonlySet<string>,
  chatApiModels: ReadonlySet<string>,
): Transport {
  if (responsesApiModels.has(model.id)) return 'responses'
  if (chatApiModels.has(model.id)) return 'chat'
  if (policy === 'chat') return 'chat'
  if (policy === 'responses') return 'responses'
  return requiresResponsesAPI(model) ? 'responses' : 'chat'
}

/**
 * Ensure a provider entry exists on `config.provider[key]` and return
 * it. If we created it just now, `created` is true so callers can log
 * one-time messages.
 */
function ensureProvider(
  config: any,
  key: string,
  defaults: () => Record<string, unknown>,
): { provider: any; created: boolean } {
  if (config.provider[key]) {
    return { provider: config.provider[key], created: false }
  }
  const provider = defaults()
  config.provider[key] = provider
  return { provider, created: true }
}

/**
 * Mutates `config` in place: ensures the litellm provider(s) exist,
 * fetches all models from the LiteLLM proxy, and merges them into the
 * appropriate transport bucket (`litellm` for /v1/chat/completions,
 * `litellm-responses` for /v1/responses).
 */
export async function enhanceConfig(config: any): Promise<void> {
  if (!config) return

  if (!config.provider) config.provider = {}
  let chatProvider = config.provider[CHAT_PROVIDER_KEY]

  // Resolve baseURL & apiKey, either from the user's primary provider
  // config or by auto-detecting a running LiteLLM proxy.
  let baseURL: string
  let apiKey: string | undefined

  if (chatProvider) {
    baseURL = normalizeBaseURL(chatProvider.options?.baseURL ?? 'http://localhost:4000')
    apiKey =
      chatProvider.options?.apiKey ??
      process.env.LITELLM_API_KEY ??
      process.env.LITELLM_MASTER_KEY
  } else {
    // Allow the user to pre-define ONLY the responses provider; in that
    // case we still need to know the baseURL/apiKey for discovery.
    const preDefinedResponses = config.provider[RESPONSES_PROVIDER_KEY]
    if (preDefinedResponses) {
      baseURL = normalizeBaseURL(preDefinedResponses.options?.baseURL ?? 'http://localhost:4000')
      apiKey =
        preDefinedResponses.options?.apiKey ??
        process.env.LITELLM_API_KEY ??
        process.env.LITELLM_MASTER_KEY
    } else {
      const detected = await autoDetectLiteLLM()
      if (!detected) {
        // Nothing to do — LiteLLM doesn't appear to be running anywhere
        // we know about. Silently bail; this is the no-op case.
        return
      }
      baseURL = normalizeBaseURL(detected)
      apiKey = process.env.LITELLM_API_KEY ?? process.env.LITELLM_MASTER_KEY
    }

    chatProvider = {
      npm: '@ai-sdk/openai-compatible',
      name: 'LiteLLM (proxy)',
      options: {
        baseURL: `${baseURL}/v1`,
        ...(apiKey ? { apiKey } : {}),
      },
      models: {},
    }
    config.provider[CHAT_PROVIDER_KEY] = chatProvider
  }

  // Verify the server is actually answering before we hammer /v1/models.
  if (!(await checkLiteLLMHealth(baseURL, apiKey))) {
    console.warn(`[opencode-litellm] LiteLLM appears offline or unauthorized at ${baseURL}`)
    return
  }

  let models: LiteLLMModel[]
  try {
    models = await discoverLiteLLMModels(baseURL, apiKey)
  } catch (error) {
    console.warn(
      '[opencode-litellm] Model discovery failed:',
      error instanceof Error ? error.message : String(error),
    )
    return
  }

  if (models.length === 0) {
    console.warn(
      '[opencode-litellm] LiteLLM responded but exposed zero models. Check your `model_list` in litellm config.yaml',
    )
    return
  }

  // Read the routing policy + per-model overrides from the chat provider's options.
  const policy: TransportPolicy =
    (chatProvider.options?.transport as TransportPolicy | undefined) ?? 'auto'
  const responsesApiModels = new Set<string>(
    Array.isArray(chatProvider.options?.responsesApiModels)
      ? chatProvider.options.responsesApiModels
      : [],
  )
  const chatApiModels = new Set<string>(
    Array.isArray(chatProvider.options?.chatApiModels) ? chatProvider.options.chatApiModels : [],
  )

  // First pass: bucket every discovered model by transport.
  const chatBucket: Record<string, any> = {}
  const responsesBucket: Record<string, any> = {}

  for (const model of models) {
    const key = safeKey(model.id)
    const entry = buildModelEntry(model)
    const transport = pickTransport(model, policy, responsesApiModels, chatApiModels)
    if (transport === 'responses') {
      responsesBucket[key] = entry
    } else {
      chatBucket[key] = entry
    }
  }

  // Lazily create the responses provider only when we actually have
  // something to put in it (or the user already declared one).
  let responsesProvider: any | undefined = config.provider[RESPONSES_PROVIDER_KEY]
  if (!responsesProvider && Object.keys(responsesBucket).length > 0) {
    responsesProvider = {
      npm: '@ai-sdk/openai',
      name: 'LiteLLM (responses)',
      options: {
        baseURL: `${baseURL}/v1`,
        ...(apiKey ? { apiKey } : {}),
        // Help the AI SDK route to /v1/responses for reasoning models
        // when the upstream supports it.
        compatibility: 'strict',
      },
      models: {},
    }
    config.provider[RESPONSES_PROVIDER_KEY] = responsesProvider
  }

  // Non-destructive merge into each provider. A key is considered
  // "already present" if it exists under EITHER provider, so the user's
  // hand-curated entry wins regardless of which bucket we'd have chosen.
  const mergeIntoProvider = (
    provider: any,
    bucket: Record<string, any>,
    bucketLabel: string,
  ): number => {
    if (!provider) return 0
    const existingHere: Record<string, any> = provider.models ?? {}
    const existingChat: Record<string, any> = chatProvider.models ?? {}
    const existingResp: Record<string, any> = responsesProvider?.models ?? {}
    const additions: Record<string, any> = {}
    for (const [key, entry] of Object.entries(bucket)) {
      if (existingHere[key]) continue
      if (existingChat[key] || existingResp[key]) continue
      additions[key] = entry
    }
    if (Object.keys(additions).length === 0) return 0
    provider.models = { ...existingHere, ...additions }
    console.log(
      `[opencode-litellm] Discovered ${Object.keys(additions).length} ${bucketLabel} model(s) from LiteLLM at ${baseURL}`,
    )
    return Object.keys(additions).length
  }

  mergeIntoProvider(chatProvider, chatBucket, 'chat-completions')
  mergeIntoProvider(responsesProvider, responsesBucket, 'responses-API')
}
