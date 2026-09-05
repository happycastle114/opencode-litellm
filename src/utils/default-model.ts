import { GPT6_ASTRA } from './model-profile'

const DEFAULT_MODEL_ORDER = [
  'coding-fast',
  'student-auto-router',
  GPT6_ASTRA.Id,
  'codex/gpt-5.6',
  'coding-strong',
] as const

/** Shared catalog fallback order; callers preserve a still-authorized explicit selection. */
export function chooseDefaultModel(modelIds: readonly string[]): string {
  for (const candidate of DEFAULT_MODEL_ORDER) {
    if (modelIds.includes(candidate)) return candidate
  }
  const first = modelIds[0]
  if (first === undefined) throw new Error('Cannot select a default model from an empty catalog.')
  return first
}
