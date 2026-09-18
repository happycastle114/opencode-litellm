import type { BundledCodexCatalog, CodexModelTemplate } from './codex-bundled-catalog'
import { buildCodexCatalog, type CodexCatalog, type LiteLLMModel } from './codex-catalog'

export function buildHybridCatalog(
  models: readonly LiteLLMModel[],
  bundled: BundledCodexCatalog,
  fallback: string,
  selected?: string,
): CodexCatalog {
  const gateway: unknown = JSON.parse(buildCodexCatalog(models, bundled, fallback).json)
  if (!isRecord(gateway) || !Array.isArray(gateway.models)) throw new Error('Invalid gateway catalog.')
  const entries = gateway.models.filter(isRecord)
  const paid = entries.find((model) => model.slug === fallback)
  if (paid === undefined) throw new Error('The hybrid fallback must be an available gateway chat model.')
  const native = bundled.templates.filter((model) =>
    typeof model.slug === 'string' && model.visibility === 'list')
  const combined: CodexModelTemplate[] = native.flatMap((model) => [
    {
      ...model, slug: `auto/${String(model.slug)}`, display_name: `${String(model.display_name ?? model.slug)} (Auto)`,
      description: `Subscription first; on quota exhaustion use LiteLLM ${fallback}`,
      ...portableLimits(model, paid), service_tiers: [], additional_speed_tiers: [],
      use_responses_lite: false, upgrade: null, availability_nux: null,
    },
    {
      ...model, slug: `subscription/${String(model.slug)}`,
      display_name: `${String(model.display_name ?? model.slug)} (Subscription)`,
      description: 'ChatGPT subscription only; no paid fallback', upgrade: null, use_responses_lite: false,
    },
  ])
  combined.push(...entries.map((model) => ({
    ...model, slug: `litellm/${String(model.slug)}`,
    display_name: `${String(model.display_name ?? model.slug)} (LiteLLM)`,
  })))
  const preferred = selected ?? `auto/${bundled.defaultModel}`
  const defaultModel = combined.some((model) => model.slug === preferred)
    ? preferred : `auto/${bundled.defaultModel}`
  return { defaultModel, json: `${JSON.stringify({ models: combined.map((model, priority) => ({ ...model, priority })) }, null, 2)}\n` }
}

function portableLimits(native: CodexModelTemplate, paid: CodexModelTemplate): CodexModelTemplate {
  const nativeWindow = typeof native.context_window === 'number' ? native.context_window : 200_000
  const paidWindow = typeof paid.context_window === 'number' ? paid.context_window : 200_000
  const window = Math.min(nativeWindow, paidWindow)
  const paidEfforts = Array.isArray(paid.supported_reasoning_levels) ? paid.supported_reasoning_levels.filter(isRecord) : []
  const nativeEfforts = Array.isArray(native.supported_reasoning_levels) ? native.supported_reasoning_levels.filter(isRecord) : []
  const efforts = nativeEfforts.filter((level) => paidEfforts.some((paidLevel) => paidLevel.effort === level.effort))
  const nativeModalities = Array.isArray(native.input_modalities) ? native.input_modalities : ['text']
  const paidModalities = Array.isArray(paid.input_modalities) ? paid.input_modalities : ['text']
  return {
    context_window: window, max_context_window: window, auto_compact_token_limit: Math.floor(window * 0.8),
    input_modalities: nativeModalities.filter((modality) => paidModalities.includes(modality)),
    supported_reasoning_levels: efforts,
    default_reasoning_level: efforts.some((level) => level.effort === native.default_reasoning_level)
      ? native.default_reasoning_level : efforts[0]?.effort ?? null,
    supports_parallel_tool_calls: native.supports_parallel_tool_calls === true && paid.supports_parallel_tool_calls === true,
    supports_image_detail_original: native.supports_image_detail_original === true && paid.supports_image_detail_original === true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
