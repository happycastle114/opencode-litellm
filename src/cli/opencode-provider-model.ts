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
  const hasLimits = model.max_input_tokens !== undefined ||
    model.max_output_tokens !== undefined
  const supportsImageInput = model.supports_vision === true ||
    model.input_modalities?.some(
      (modality) => modality.toLowerCase() === INPUT_MODALITY.Image,
    ) === true
  return {
    name: formatModelName({ id: model.id, object: model.object ?? 'model' }),
    ...(hasLimits
      ? {
          limit: {
            context: model.max_input_tokens ?? 0,
            output: model.max_output_tokens ?? 0,
          },
        }
      : {}),
    ...(model.supports_function_calling === true ? { tool_call: true } : {}),
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
