/** Documented capabilities used when the gateway omits optional model metadata. */
export const GPT6_ASTRA = {
  Id: 'gpt-6-astra',
  DisplayName: 'GPT-6 Astra',
  ContextWindow: 1_050_000,
  OutputTokens: 128_000,
  DefaultReasoning: 'medium',
  ReasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
} as const

export function isGpt6Astra(id: string): boolean {
  return id.split('/').at(-1) === GPT6_ASTRA.Id
}
