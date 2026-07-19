import type { Config, Plugin, PluginInput } from '@opencode-ai/plugin'
import {
  autoDetectLiteLLM,
  checkLiteLLMHealth,
  discoverLiteLLMModels,
  normalizeBaseURL,
} from '../utils/litellm-api'
import {
  formatModelName,
  extractModelOwner,
  categorizeModel,
} from '../utils/format-model-name'
import type { LiteLLMModel } from '../types'
import {
  resolveSearchApiKey,
  type LiteLLMSearchEndpoint,
} from '../search/client'
import { parseSearchToolOptions } from '../search/options'
import { createSearchTools } from '../search/tools'

const CHAT_PROVIDER_ID = 'litellm'
const DISCOVERY_TIMEOUT_MS = 5000

/**
 * Read `customHeaders` from a provider options block.
 */
function readCustomHeaders(
  options: Record<string, unknown>,
): Record<string, string> | undefined {
  const raw = options.customHeaders
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return undefined
}

/**
 * Convert a discovered LiteLLM model into an OpenCode config-level
 * model entry (the shape used in `provider.*.models` inside
 * `opencode.json`).
 */
function toConfigModel(model: LiteLLMModel): Record<string, unknown> {
  const type = categorizeModel(model)
  const entry: Record<string, unknown> = {
    name: formatModelName(model),
  }
  if (model.max_input_tokens || model.max_output_tokens) {
    entry.limit = {
      context: model.max_input_tokens ?? 0,
      output: model.max_output_tokens ?? 0,
    }
  }
  if (model.supports_function_calling) {
    entry.tool_call = true
  }
  if (model.supports_vision) {
    entry.attachment = true
  }
  if (type === 'embedding' || type === 'image' || type === 'audio') {
    // skip non-chat models from the config — they can't be used as
    // primary chat models and would clutter the picker.
    return entry
  }
  return entry
}

/**
 * LiteLLM Plugin for OpenCode.
 *
 * Uses the `config` hook to discover models from a LiteLLM proxy and
 * inject them into the provider's `models` map at startup. This is the
 * only reliable way to dynamically populate a provider — the
 * `provider.models` hook is not called by OpenCode for custom providers.
 *
 * Configure the provider in your `opencode.json`:
 *
 * {
 *   "plugin": ["opencode-plugin-litellm@latest"],
 *   "provider": {
 *     "litellm": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "name": "LiteLLM (proxy)",
 *       "options": {
 *         "baseURL": "http://localhost:4000/v1",
 *         "apiKey": "{env:LITELLM_API_KEY}"
 *       }
 *     }
 *   }
 * }
 */
export const LiteLLMPlugin: Plugin = async (
  _input: PluginInput,
  pluginOptions,
) => {
  const searchToolOptions = parseSearchToolOptions(pluginOptions)
  let searchEndpoint: LiteLLMSearchEndpoint | undefined
  const searchTools = createSearchTools(
    searchToolOptions,
    () => searchEndpoint,
  )
  return {
    config: async (config: Config) => {
      // Ensure the provider entry exists
      if (!config.provider) config.provider = {}

      const existing = config.provider[CHAT_PROVIDER_ID] as
        | Record<string, unknown>
        | undefined
      const options = (existing?.options ?? {}) as Record<string, unknown>
      const configuredBase =
        typeof options.baseURL === 'string' ? options.baseURL : undefined
      const configuredKey =
        typeof options.apiKey === 'string' && options.apiKey
          ? options.apiKey
          : undefined
      const envKey =
        process.env.LITELLM_API_KEY ?? process.env.LITELLM_MASTER_KEY
      const apiKey = configuredKey ?? envKey
      const customHeaders = readCustomHeaders(options)

      // Resolve base URL
      let baseURL: string | null = null
      if (configuredBase) {
        baseURL = normalizeBaseURL(configuredBase)
      } else {
        baseURL = await autoDetectLiteLLM(apiKey, customHeaders)
      }

      if (!baseURL) {
        console.warn(
          '[opencode-litellm] No LiteLLM proxy found. Configure provider.litellm.options.baseURL or start LiteLLM on port 4000/8000/8080.',
        )
        return
      }
      const resolvedBaseURL = baseURL
      searchEndpoint = {
        baseURL: resolvedBaseURL,
        apiKey: resolveSearchApiKey(configuredKey),
        customHeaders,
      }

      // Create provider entry if it doesn't exist
      if (!existing) {
        config.provider[CHAT_PROVIDER_ID] = {
          npm: '@ai-sdk/openai-compatible',
          name: 'LiteLLM (proxy)',
          options: {
            baseURL: `${baseURL}/v1`,
          },
          models: {},
        }
      }

      const provider = config.provider[CHAT_PROVIDER_ID] as Record<
        string,
        unknown
      >

      // Ensure npm is set
      if (!provider.npm) {
        provider.npm = '@ai-sdk/openai-compatible'
      }

      // Ensure options.baseURL is set
      if (!provider.options) {
        provider.options = { baseURL: `${baseURL}/v1` }
      }

      // Ensure models map exists
      if (!provider.models) {
        provider.models = {}
      }

      const models = provider.models as Record<string, unknown>

      // Discover models with timeout
      const work = async () => {
        if (!(await checkLiteLLMHealth(resolvedBaseURL, apiKey, customHeaders))) {
          console.warn(
            `[opencode-litellm] LiteLLM appears offline or unauthorized at ${baseURL}`,
          )
          return
        }

        let discovered: LiteLLMModel[]
        try {
          discovered = await discoverLiteLLMModels(
            resolvedBaseURL,
            apiKey,
            customHeaders,
          )
        } catch (error) {
          console.warn(
            '[opencode-litellm] Model discovery failed:',
            error instanceof Error ? error.message : String(error),
          )
          return
        }

        if (discovered.length === 0) {
          console.warn(
            '[opencode-litellm] LiteLLM responded but exposed zero models.',
          )
          return
        }

        for (const model of discovered) {
          // Don't overwrite user-curated entries
          if (models[model.id]) continue
          models[model.id] = toConfigModel(model)
        }

        // Remove the seed placeholder if real models were discovered
        if (models['_'] && Object.keys(models).length > 1) {
          delete models['_']
        }

        console.log(
          `[opencode-litellm] Discovered ${discovered.length} models from ${baseURL}`,
        )
      }

      await Promise.race([
        work(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, DISCOVERY_TIMEOUT_MS),
        ),
      ])
    },
    ...(searchToolOptions.length === 0 ? {} : { tool: searchTools }),
  }
}

// Re-export the responses plugin for backwards compat, but it's now a no-op.
// The config hook approach handles all models in a single provider.
export const LiteLLMResponsesPlugin: Plugin = async (_input: PluginInput) => {
  return {}
}
