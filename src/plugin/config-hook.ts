import { enhanceConfig } from './enhance-config'

const ENHANCE_TIMEOUT_MS = 5000

/**
 * Returns the OpenCode `config` lifecycle hook.
 *
 * The hook is fire-and-merge: we attempt to enrich the user's config
 * with models discovered from LiteLLM, but we cap the wall-clock cost
 * so a slow / unreachable proxy never blocks OpenCode startup.
 */
export function createConfigHook() {
  return async (config: any) => {
    if (!config) return

    if (Object.isFrozen?.(config) || Object.isSealed?.(config)) {
      console.warn('[opencode-litellm] Config object is frozen/sealed - cannot inject discovered models')
      return
    }

    try {
      await Promise.race([
        enhanceConfig(config),
        new Promise<void>((resolve) => setTimeout(resolve, ENHANCE_TIMEOUT_MS)),
      ])
    } catch (error) {
      console.error('[opencode-litellm] Config enhancement failed:', error)
    }

    const chatCount = config?.provider?.litellm?.models
      ? Object.keys(config.provider.litellm.models).length
      : 0
    const responsesCount = config?.provider?.['litellm-responses']?.models
      ? Object.keys(config.provider['litellm-responses'].models).length
      : 0

    if (chatCount + responsesCount === 0 && config?.provider?.litellm) {
      console.warn('[opencode-litellm] No models loaded — is LiteLLM reachable and is your model_list non-empty?')
    }
  }
}
