import { getModelProfile } from '../utils/model-profile'
import { formatModelName } from '../utils/format-model-name'
import { classifyModel, MODEL_TYPE } from '../utils/model-modality'
import type { CodexDiscoveryModel } from './codex-discovery-model'

const INPUT_MODALITY = { Image: 'image' } as const

export type OpenCodeProviderModel = {
  readonly name: string
  readonly limit?: {
    readonly context: number
    readonly output: number
  }
  readonly tool_call?: true
  readonly modalities?: { readonly input: readonly string[]; readonly output: readonly string[] }
  readonly reasoning?: true
  readonly variants?: Readonly<Record<string, { readonly reasoningEffort: string }>>
  readonly attachment?: true
}

export function toOpenCodeProviderModel(
  model: CodexDiscoveryModel,
): OpenCodeProviderModel | undefined {
  const type = classifyModel(model)
  if (
    type === MODEL_TYPE.Embedding ||
    type === MODEL_TYPE.Image ||
    type === MODEL_TYPE.Audio
  ) {
    return undefined
  }
  const profile = getModelProfile(model.id)
  const hasLimits = profile !== undefined || model.max_input_tokens !== undefined ||
    model.max_output_tokens !== undefined
  const supportsImageInput = profile !== undefined || model.supports_vision === true ||
    model.input_modalities?.some(
      (modality) => modality.toLowerCase() === INPUT_MODALITY.Image,
    ) === true
  return {
    name: profile?.DisplayName ?? formatModelName({ id: model.id, object: model.object ?? 'model' }),
    ...(hasLimits
      ? {
          limit: {
            context: profile?.ContextWindow ?? model.max_input_tokens ?? 0,
            output: model.max_output_tokens ?? profile?.OutputTokens ?? 0,
          },
        }
      : {}),
    ...(profile !== undefined ? {
      modalities: { input: ['text', 'image'], output: ['text'] },
      reasoning: true as const,
      variants: Object.fromEntries(
        profile.ReasoningLevels.map((reasoningEffort) => [reasoningEffort, { reasoningEffort }]),
      ),
    } : {}),
    ...(profile !== undefined || model.supports_function_calling === true ? { tool_call: true } : {}),
    ...(supportsImageInput ? { attachment: true } : {}),
  }
}

export function buildOpenCodeProviderModels(
  models: readonly CodexDiscoveryModel[],
): Readonly<Record<string, OpenCodeProviderModel>> {
  const entries: Array<readonly [string, OpenCodeProviderModel]> = []
  for (const model of models) {
    const entry = toOpenCodeProviderModel(model)
    if (entry !== undefined) entries.push([model.id, entry])
  }
  return Object.fromEntries(entries)
}
