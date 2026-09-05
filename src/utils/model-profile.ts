/** Documented capabilities used when the gateway omits optional model metadata. */
export const GPT6_ASTRA = {
  Id: 'gpt-6-astra',
  DisplayName: 'GPT-6 Astra',
  ContextWindow: 1_050_000,
  OutputTokens: 128_000,
  DefaultReasoning: 'medium',
  ReasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
} as const

export const GPT56_TERRA = {
  Id: 'gpt-5.6-terra',
  DisplayName: 'GPT-5.6 Terra',
  ContextWindow: 1_050_000,
  OutputTokens: 128_000,
  DefaultReasoning: 'medium',
  ReasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
} as const

const MODEL_PROFILES = [GPT6_ASTRA, GPT56_TERRA] as const
export type ModelProfile = (typeof MODEL_PROFILES)[number]

export function getModelProfile(id: string): ModelProfile | undefined {
  const modelId = id.split('/').at(-1)
  return MODEL_PROFILES.find((profile) => profile.Id === modelId)
}
