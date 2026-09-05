export const STUDENT_AUTO = {
  Id: 'student-auto',
  OpenCodeId: 'litellm/student-auto',
  SmallModel: 'litellm/gpt-5.6-luna',
  OpenCodePrefix: 'litellm/',
  DisplayName: 'Student Auto',
  ContextWindow: 500_000,
  OutputTokens: 128_000,
  DefaultReasoning: 'medium',
  ReasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
} as const

const STUDENT_MODEL_IDS: ReadonlySet<string> = new Set([
  STUDENT_AUTO.Id, 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra',
])

/** Apply student defaults only to the gateway's complete, narrow student catalog. */
export function isStudentCatalog(models: readonly { readonly id: string }[]): boolean {
  const ids = new Set(models.map((model) => model.id))
  return ids.size === STUDENT_MODEL_IDS.size && [...ids].every((id) => STUDENT_MODEL_IDS.has(id))
}
