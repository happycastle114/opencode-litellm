const MODEL_FIELD = {
  Data: 'data',
  Id: 'id',
  Object: 'object',
  Mode: 'mode',
  Type: 'type',
  ModelType: 'model_type',
  InputModalities: 'input_modalities',
  MaxInputTokens: 'max_input_tokens',
  MaxOutputTokens: 'max_output_tokens',
  SupportsFunctionCalling: 'supports_function_calling',
  SupportsVision: 'supports_vision',
} as const

export type CodexDiscoveryModel = {
  readonly id: string
  readonly object?: string
  readonly mode?: string
  readonly type?: string
  readonly model_type?: string
  readonly input_modalities?: readonly string[]
  readonly max_input_tokens?: number
  readonly max_output_tokens?: number
  readonly supports_function_calling?: boolean
  readonly supports_vision?: boolean
}

export function parseCodexDiscoveryModels(
  payload: unknown,
): readonly CodexDiscoveryModel[] | undefined {
  const rows = dataRows(payload)
  if (rows === undefined) return undefined
  const models: CodexDiscoveryModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const model = parseModel(row)
    if (model === undefined || seen.has(model.id)) continue
    seen.add(model.id)
    models.push(model)
  }
  return models.length === 0 ? undefined : models
}

function parseModel(value: unknown): CodexDiscoveryModel | undefined {
  if (!isRecord(value)) return undefined
  const id = readOptionalString(value[MODEL_FIELD.Id])
  if (id === undefined) return undefined
  const object = readOptionalString(value[MODEL_FIELD.Object])
  const mode = readOptionalString(value[MODEL_FIELD.Mode])
  const type = readOptionalString(value[MODEL_FIELD.Type])
  const modelType = readOptionalString(value[MODEL_FIELD.ModelType])
  const inputModalities = readOptionalStringArray(value[MODEL_FIELD.InputModalities])
  const maxInputTokens = readOptionalPositiveNumber(value[MODEL_FIELD.MaxInputTokens])
  const maxOutputTokens = readOptionalPositiveNumber(value[MODEL_FIELD.MaxOutputTokens])
  const supportsFunctionCalling = readOptionalBoolean(value[MODEL_FIELD.SupportsFunctionCalling])
  const supportsVision = readOptionalBoolean(value[MODEL_FIELD.SupportsVision])
  return {
    id,
    ...(object === undefined ? {} : { object }),
    ...(mode === undefined ? {} : { mode }),
    ...(type === undefined ? {} : { type }),
    ...(modelType === undefined ? {} : { model_type: modelType }),
    ...(inputModalities === undefined ? {} : { input_modalities: inputModalities }),
    ...(maxInputTokens === undefined ? {} : { max_input_tokens: maxInputTokens }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(supportsFunctionCalling === undefined ? {} : { supports_function_calling: supportsFunctionCalling }),
    ...(supportsVision === undefined ? {} : { supports_vision: supportsVision }),
  }
}

function dataRows(value: unknown): readonly unknown[] | undefined {
  if (!isRecord(value)) return undefined
  const data = value[MODEL_FIELD.Data]
  return Array.isArray(data) ? data : undefined
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function readOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.map(readOptionalString).filter(
    (entry): entry is string => entry !== undefined,
  )
  return values.length === 0 ? undefined : values
}

function readOptionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
