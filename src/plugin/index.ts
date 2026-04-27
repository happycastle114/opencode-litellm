import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { createConfigHook } from './config-hook'

/**
 * LiteLLM Plugin for OpenCode
 *
 * Auto-detects a running LiteLLM proxy (default port 4000) and pulls
 * the full `model_list` out of `/v1/models` so you don't have to
 * hand-maintain models in `opencode.json`.
 *
 * Discovered models are split into two providers based on the transport
 * required by the upstream model:
 *
 *   - `litellm`           → /v1/chat/completions (most models)
 *   - `litellm-responses` → /v1/responses        (gpt-5*, o-series with reasoning)
 *
 * The split is necessary because reasoning-tier OpenAI models reject
 * requests that combine `reasoning_effort` with function tools when sent
 * to chat-completions.
 *
 * Configure (optional):
 *
 * {
 *   "plugin": ["opencode-plugin-litellm@latest"],
 *   "provider": {
 *     "litellm": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "name": "LiteLLM (proxy)",
 *       "options": {
 *         "baseURL": "http://localhost:4000/v1",
 *         "apiKey": "{env:LITELLM_API_KEY}",
 *
 *         // Optional routing controls (added in 0.2.0):
 *         "transport": "auto",                       // "auto" | "chat" | "responses"
 *         "responsesApiModels": ["gpt-5-4-high"],    // force into /v1/responses
 *         "chatApiModels": ["o1-mini"]               // force into /v1/chat/completions
 *       }
 *     }
 *   }
 * }
 */
export const LiteLLMPlugin: Plugin = async (_input: PluginInput) => {
  console.log('[opencode-litellm] LiteLLM plugin initialized')

  return {
    config: createConfigHook(),
  }
}
