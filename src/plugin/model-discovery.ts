import { chooseDefaultModel } from '../utils/default-model'
import { isStudentCatalog, STUDENT_AUTO } from '../utils/student-catalog'
import type { PublicPluginConfig } from './provider-resolution'
import {
  discoverLiteLLMModels,
} from '../utils/litellm-api'
import {
  toOpenCodeProviderModel,
} from '../cli/opencode-provider-model'
import type { LiteLLMModel } from '../types'

const MODEL_PATTERN = { PrefixWildcard: '/*', Placeholder: '_' } as const
const AUTHORIZATION_SENTINELS = new Set(['*', 'all-proxy-models', 'all-team-models'])

export type ModelDiscoveryInput = {
  readonly baseURL: string
  readonly apiKey: string | undefined
  readonly customHeaders: Record<string, string> | undefined
  readonly signal: AbortSignal
  readonly config?: PublicPluginConfig
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

  const authorized = new Set(discovered.map((model) => model.id))
  const pruned = new Set<string>()
  if (!discovered.some((model) => AUTHORIZATION_SENTINELS.has(model.id))) {
    const prefixes = discovered.filter((model) => model.id.endsWith(MODEL_PATTERN.PrefixWildcard)).map((model) => model.id.slice(0, -1))
    for (const id of Object.keys(input.models)) {
      if (!authorized.has(id) && !prefixes.some((prefix) => id.startsWith(prefix))) {
        delete input.models[id]
        pruned.add(id)
      }
    }
  }
  if (isStudentCatalog(discovered)) {
    if (input.config !== undefined) input.config.small_model = STUDENT_AUTO.SmallModel
    const selected = input.config?.model
    if (input.config !== undefined && (selected === undefined ||
      (selected.startsWith(STUDENT_AUTO.OpenCodePrefix) && !authorized.has(selected.slice(STUDENT_AUTO.OpenCodePrefix.length))))) {
      input.config.model = STUDENT_AUTO.OpenCodeId
    }
  }

  for (const model of discovered) {
    if (input.models[model.id]) continue
    const entry = toConfigModel(model)
    if (entry === undefined) continue
    input.models[model.id] = entry
  }

  const selected = input.config?.model
  const available = Object.keys(input.models).filter((id) => id !== MODEL_PATTERN.Placeholder && !AUTHORIZATION_SENTINELS.has(id) && !id.endsWith(MODEL_PATTERN.PrefixWildcard)).sort()
  if (input.config !== undefined && selected?.startsWith(STUDENT_AUTO.OpenCodePrefix) &&
    pruned.has(selected.slice(STUDENT_AUTO.OpenCodePrefix.length)) && available.length > 0) {
    input.config.model = `${STUDENT_AUTO.OpenCodePrefix}${chooseDefaultModel(available)}`
  }

  if (input.models['_'] && Object.keys(input.models).length > 1) {
    delete input.models['_']
  }

  console.log(
    `[opencode-litellm] Discovered ${discovered.length} models from ${input.baseURL}`,
  )
}
