import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { createConfigHook } from './config-hook'

/**
 * LiteLLM Plugin for OpenCode
 *
 * Auto-detects a running LiteLLM proxy (default port 4000) and pulls
 * the full `model_list` out of `/v1/models` so you don't have to
 * hand-maintain models in `opencode.json`.
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
 *         "apiKey": "{env:LITELLM_API_KEY}"
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
