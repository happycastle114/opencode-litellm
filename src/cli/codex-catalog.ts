import { isStudentCatalog, STUDENT_AUTO } from '../utils/student-catalog'
import { GPT6_ASTRA, getModelProfile } from '../utils/model-profile'
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
  GPT6_ASTRA.Id,
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
  preferredDefaultModel?: string,
): CodexCatalog {
  const modelIds = [...new Set(
    models.filter((model) => !isKnownNonChatModel(model))
      .map((model) => model.id.trim()).filter((id) => id !== ''),
  )].sort()
  if (modelIds.length === 0) throw new Error('LiteLLM returned no usable models for the Codex catalog.')
  const defaultModel = preferredDefaultModel !== undefined && modelIds.includes(preferredDefaultModel)
    ? preferredDefaultModel
    : isStudentCatalog(models) ? STUDENT_AUTO.Id : chooseDefaultModel(modelIds)
  const orderedModelIds = [defaultModel, ...modelIds.filter((slug) => slug !== defaultModel)]
  const catalog = {
    models: orderedModelIds.map((slug, index) => {
      const profile = getModelProfile(slug)
      const isQwenPreview = slug === QWEN_GATEWAY_MODEL
      const contextWindow = profile?.ContextWindow ?? (isQwenPreview
        ? QWEN_CATALOG_METADATA.ContextWindow
        : CATALOG_DEFAULT_METADATA.ContextWindow)
      return {
        ...template,
        slug,
        display_name: profile?.DisplayName ?? (isQwenPreview ? QWEN_CATALOG_METADATA.DisplayName : slug),
        description: 'LiteLLM gateway model',
        visibility: CATALOG_VISIBILITY.List,
        supported_in_api: true,
        priority: index,
        context_window: contextWindow,
        max_context_window: contextWindow,
        auto_compact_token_limit: Math.floor(contextWindow * 0.9),
        effective_context_window_percent: 95,
        input_modalities: profile !== undefined || isQwenPreview
          ? [CATALOG_INPUT_MODALITY.Text, CATALOG_INPUT_MODALITY.Image]
          : [CATALOG_INPUT_MODALITY.Text],
        ...(profile !== undefined ? { default_reasoning_level: profile.DefaultReasoning } : {}),
        supported_reasoning_levels: profile?.ReasoningLevels.map((effort) => ({ effort, description: effort })) ?? [],
        supports_parallel_tool_calls: false,
        supports_search_tool: true,
        supports_image_detail_original: false,
        use_responses_lite: false,
        additional_speed_tiers: [],
        service_tiers: [],
        availability_nux: null,
        upgrade: null,
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
