import type { Plugin } from '@opencode-ai/plugin'
import type { LiteLLMSearchEndpoint } from '../search/client'
import { parseSearchToolOptions } from '../search/options'
import { createSearchTools } from '../search/tools'
import {
  parseMcpDiscoveryOptions,
  parseMcpToolsetOptions,
} from '../mcp/options'
import {
  PROVIDER_RESOLUTION,
  resolveProvider,
  toSearchEndpoint,
  type PublicPluginConfig,
} from './provider-resolution'
import { discoverAndMergeModels } from './model-discovery'
import { discoverAndMergeMcpServers } from './mcp-discovery'

type PublicPluginHooks = {
  readonly config?: (config: PublicPluginConfig) => Promise<void>
  readonly [key: string]: unknown
}

type PublicPlugin = (
  input: object,
  options?: Record<string, unknown>,
) => Promise<PublicPluginHooks>

const DISCOVERY_TIMEOUT_MS = 5000
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
const liteLLMPluginImplementation: PublicPlugin = (async (
  _input: object,
  pluginOptions?: Record<string, unknown>,
): Promise<PublicPluginHooks> => {
  const searchToolOptions = parseSearchToolOptions(pluginOptions)
  const mcpDiscoveryOptions = parseMcpDiscoveryOptions(pluginOptions)
  const mcpToolsets = parseMcpToolsetOptions(pluginOptions)
  let searchEndpoint: LiteLLMSearchEndpoint | undefined
  const searchTools = createSearchTools(
    searchToolOptions,
    () => searchEndpoint,
  )
  return {
    config: async (config: PublicPluginConfig) => {
      searchEndpoint = undefined
      const resolution = await resolveProvider(config)
      if (resolution.kind === PROVIDER_RESOLUTION.UnresolvedCredential) {
        console.warn(
          '[opencode-litellm] Configured LiteLLM credential could not be resolved; discovery is disabled.',
        )
        return
      }
      if (resolution.kind === PROVIDER_RESOLUTION.Unavailable) {
        console.warn(
          '[opencode-litellm] No LiteLLM proxy found. Configure provider.litellm.options.baseURL or start LiteLLM on port 4000/8000/8080.',
        )
        return
      }
      searchEndpoint = toSearchEndpoint(resolution)
      const discoveryController = new AbortController()
      const timeout = setTimeout(
        () => discoveryController.abort(),
        DISCOVERY_TIMEOUT_MS,
      )
      try {
        await Promise.all([
          discoverAndMergeModels({
            baseURL: resolution.baseURL,
            apiKey: resolution.apiKey,
            customHeaders: resolution.customHeaders,
            signal: discoveryController.signal,
            models: resolution.models,
          }),
          discoverAndMergeMcpServers({
            config: resolution.config,
            baseURL: resolution.baseURL,
            apiKey: resolution.apiKey,
            customHeaders: resolution.customHeaders,
            options: mcpDiscoveryOptions,
            toolsets: mcpToolsets,
            signal: discoveryController.signal,
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    ...(searchToolOptions.length === 0 ? {} : { tool: searchTools }),
  }
}) satisfies Plugin

// Re-export the responses plugin for backwards compat, but it's now a no-op.
// The config hook approach handles all models in a single provider.
const liteLLMResponsesPluginImplementation: PublicPlugin = (async (_input: object): Promise<PublicPluginHooks> => {
  return {}
}) satisfies Plugin

export const LiteLLMPlugin = liteLLMPluginImplementation
export const LiteLLMResponsesPlugin = liteLLMResponsesPluginImplementation
