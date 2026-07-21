import {
  discoverLiteLLMModels,
} from '../utils/litellm-api'
import {
  toOpenCodeProviderModel,
} from '../cli/opencode-provider-model'
import type { LiteLLMModel } from '../types'

export type ModelDiscoveryInput = {
  readonly baseURL: string
  readonly apiKey: string | undefined
  readonly customHeaders: Record<string, string> | undefined
  readonly signal: AbortSignal
  readonly models: Record<string, unknown>
}

export function toConfigModel(
  model: LiteLLMModel,
): Record<string, unknown> | undefined {
  return toOpenCodeProviderModel(model)
}

export async function discoverAndMergeModels(
  input: ModelDiscoveryInput,
): Promise<void> {
  const discovered = await discoverLiteLLMModels(
    input.baseURL,
    input.apiKey,
    input.customHeaders,
    input.signal,
    { allowAmbientFallback: false },
  )
  if (discovered.length === 0) {
    console.warn(
      '[opencode-litellm] LiteLLM responded but exposed zero models.',
    )
    return
  }

  for (const model of discovered) {
    if (input.models[model.id]) continue
    const entry = toConfigModel(model)
    if (entry === undefined) continue
    input.models[model.id] = entry
  }

  if (input.models['_'] && Object.keys(input.models).length > 1) {
    delete input.models['_']
  }

  console.log(
    `[opencode-litellm] Discovered ${discovered.length} models from ${input.baseURL}`,
  )
}
