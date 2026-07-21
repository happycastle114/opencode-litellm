import { classifyModel, MODEL_TYPE } from '../utils/model-modality'
import { QWEN_GATEWAY_MODEL } from './qwen-routing'
import type { CodexModelTemplate } from './codex-bundled-catalog'

const CATALOG_VISIBILITY = { List: 'list' } as const
const CATALOG_INPUT_MODALITY = { Image: 'image', Text: 'text' } as const
const CATALOG_DEFAULT_METADATA = {
  ContextWindow: 200_000,
  DefaultReasoningLevel: 'medium',
} as const
const QWEN_CATALOG_METADATA = {
  ContextWindow: 1_000_000,
  DisplayName: 'Qwen3.8 Max Preview',
} as const
const DEFAULT_MODEL_ORDER = [
  'coding-fast',
  'student-auto-router',
  'codex/gpt-5.6',
  'coding-strong',
] as const

export type LiteLLMModel = {
  readonly id: string
  readonly object?: string
  readonly mode?: string
  readonly type?: string
  readonly model_type?: string
  readonly input_modalities?: readonly string[]
}

export type CodexCatalog = {
  readonly defaultModel: string
  readonly json: string
}

export function buildCodexCatalog(
  models: readonly LiteLLMModel[],
  template: CodexModelTemplate,
): CodexCatalog {
  const modelIds = [...new Set(
    models.filter((model) => !isKnownNonChatModel(model))
      .map((model) => model.id.trim()).filter((id) => id !== ''),
  )].sort()
  if (modelIds.length === 0) throw new Error('LiteLLM returned no usable models for the Codex catalog.')
  const defaultModel = chooseDefaultModel(modelIds)
  const orderedModelIds = [defaultModel, ...modelIds.filter((slug) => slug !== defaultModel)]
  const catalog = {
    models: orderedModelIds.map((slug) => {
      const isQwenPreview = slug === QWEN_GATEWAY_MODEL
      const contextWindow = isQwenPreview
        ? QWEN_CATALOG_METADATA.ContextWindow
        : CATALOG_DEFAULT_METADATA.ContextWindow
      return {
        ...template,
        slug,
        display_name: isQwenPreview ? QWEN_CATALOG_METADATA.DisplayName : slug,
        description: 'LiteLLM gateway model',
        default_reasoning_level: CATALOG_DEFAULT_METADATA.DefaultReasoningLevel,
        visibility: CATALOG_VISIBILITY.List,
        supported_in_api: true,
        additional_speed_tiers: [],
        service_tiers: [],
        default_service_tier: null,
        availability_nux: null,
        upgrade: null,
        input_modalities: isQwenPreview
          ? [CATALOG_INPUT_MODALITY.Text, CATALOG_INPUT_MODALITY.Image]
          : [CATALOG_INPUT_MODALITY.Text],
        supports_image_detail_original: false,
        supported_reasoning_levels: [],
        supports_reasoning_summaries: false,
        supports_parallel_tool_calls: false,
        supports_search_tool: false,
        support_verbosity: false,
        context_window: contextWindow,
        max_context_window: contextWindow,
        experimental_supported_tools: [],
        use_responses_lite: false,
        priority: slug === defaultModel ? 1 : 100,
      }
    }),
  }
  return { defaultModel, json: `${JSON.stringify(catalog, null, 2)}\n` }
}

function chooseDefaultModel(modelIds: readonly string[]): string {
  for (const candidate of DEFAULT_MODEL_ORDER) {
    if (modelIds.includes(candidate)) return candidate
  }
  return modelIds[0] ?? unreachableCatalog()
}

function isKnownNonChatModel(model: LiteLLMModel): boolean {
  const type = classifyModel(model)
  return type === MODEL_TYPE.Embedding || type === MODEL_TYPE.Image || type === MODEL_TYPE.Audio
}

function unreachableCatalog(): never {
  throw new Error('Codex catalog cannot select a default model from an empty list.')
}
