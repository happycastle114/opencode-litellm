import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { discoverBucket } from './discover'

const CHAT_PROVIDER_ID = 'litellm'
const RESPONSES_PROVIDER_ID = 'litellm-responses'

/**
 * LiteLLM Plugin for OpenCode.
 *
 * Implements the `provider.models` hook so OpenCode populates the
 * `litellm` provider's model list from a live LiteLLM proxy at
 * startup.
 *
 * **Important:** OpenCode only calls `provider.models` when the
 * provider has at least one model defined in `opencode.json`. You
 * must include a seed model entry — it can be any model id your
 * proxy exposes. The plugin will discover and add all remaining
 * models automatically.
 *
 * By default, every discovered model is registered under the
 * `litellm` provider — including OpenAI reasoning-tier models like
 * `gpt-5*`. Most of those models work fine through
 * `/v1/chat/completions` for normal use. If you actually hit the
 * "Function tools with reasoning_effort are not supported" error
 * from OpenAI, declare a sibling `litellm-responses` provider in
 * `opencode.json` (see {@link LiteLLMResponsesPlugin}) and the
 * plugin will route those models through `/v1/responses` instead.
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
 *       },
 *       "models": {
 *         "_": { "name": "seed" }
 *       }
 *     }
 *   }
 * }
 */
export const LiteLLMPlugin: Plugin = async (_input: PluginInput) => {
  return {
    provider: {
      id: CHAT_PROVIDER_ID,
      models: async (provider) => {
        // 'all' (not 'chat') by default so reasoning-tier models like
        // gpt-5* don't silently disappear when the user hasn't opted
        // into the responses-API split. The split only kicks in when
        // the user explicitly declares a `litellm-responses` provider.
        return discoverBucket('all', provider, {
          id: CHAT_PROVIDER_ID,
          url: '',
          npm: '@ai-sdk/openai-compatible',
        })
      },
    },
  }
}

/**
 * Optional sibling plugin that registers the `litellm-responses`
 * provider for OpenAI reasoning-tier models.
 *
 * OpenAI's reasoning-tier models (`gpt-5*`, `o1`/`o3`/`o4*`) reject
 * requests that combine `reasoning_effort` with function tools when
 * sent to `/v1/chat/completions`. Routing those models through
 * `/v1/responses` (the OpenAI Responses API) avoids the rejection.
 *
 * This plugin is only active when the `litellm-responses` provider
 * is declared in `opencode.json`. When it is, the chat-only `litellm`
 * provider continues to register every discovered model — set
 * `chatApiModels` / `responsesApiModels` on either provider's options
 * if you want to control which side a particular model lives on.
 *
 * Example `opencode.json` snippet:
 *
 * {
 *   "provider": {
 *     "litellm-responses": {
 *       "npm": "@ai-sdk/openai",
 *       "name": "LiteLLM (responses)",
 *       "options": {
 *         "baseURL": "http://localhost:4000/v1",
 *         "apiKey": "{env:LITELLM_API_KEY}",
 *         "compatibility": "strict"
 *       }
 *     }
 *   }
 * }
 */
export const LiteLLMResponsesPlugin: Plugin = async (_input: PluginInput) => {
  return {
    provider: {
      id: RESPONSES_PROVIDER_ID,
      models: async (provider) => {
        return discoverBucket('responses', provider, {
          id: RESPONSES_PROVIDER_ID,
          url: '',
          npm: '@ai-sdk/openai',
        })
      },
    },
  }
}
