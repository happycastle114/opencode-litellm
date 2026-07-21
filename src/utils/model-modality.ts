import type { ModelType } from '../types'

export const MODEL_MODALITY = {
  Chat: 'chat',
  Completion: 'completion',
  Responses: 'responses',
  Embedding: 'embedding',
  Image: 'image',
  ImageGeneration: 'image_generation',
  Audio: 'audio',
  Speech: 'speech',
  Transcription: 'transcription',
  TextToSpeech: 'text-to-speech',
} as const

export const MODEL_TYPE = {
  Chat: 'chat',
  Embedding: 'embedding',
  Image: 'image',
  Audio: 'audio',
} as const

export type ModelModalityMetadata = {
  readonly mode?: string
  readonly type?: string
  readonly model_type?: string
}

export type ClassifiableModel = ModelModalityMetadata & {
  readonly id: string
}

const MODEL_ID_PATTERN = {
  Embedding: /(?:^|[/._-])embed(?:ding)?(?:$|[/._-])/,
  ImageGeneration: /(?:^|[/._-])(?:dall[-_.]?e|stable[-_.]?diffusion|gpt[-_.]?image|image[-_.]?(?:gen(?:eration)?|edit(?:ing)?|variation)|flux)(?:$|[/._-])/,
  MediaGeneration: /(?:^|[/._-])(?:i2v|t2v|r2v|v2v|ti2v|t2i|i2i)(?:$|[/._-])/,
  Audio: /(?:^|[/._-])(?:whisper|tts|stt|transcrib(?:e|er)|transcription|speech|text[-_.]?to[-_.]?speech|audio[-_.]?(?:generation|speech|transcription|transcribe))(?:$|[/._-])/,
} as const

export function classifyModel(
  model: ClassifiableModel,
): Exclude<ModelType, 'unknown'> | undefined {
  const metadataType = classifyModelMetadata(model)
  if (metadataType !== undefined) return metadataType

  const id = normalize(model.id)
  if (id === undefined) return undefined
  if (MODEL_ID_PATTERN.Embedding.test(id)) return MODEL_TYPE.Embedding
  if (MODEL_ID_PATTERN.ImageGeneration.test(id) || MODEL_ID_PATTERN.MediaGeneration.test(id)) {
    return MODEL_TYPE.Image
  }
  if (MODEL_ID_PATTERN.Audio.test(id)) return MODEL_TYPE.Audio
  return undefined
}

export function classifyModelMetadata(
  model: ModelModalityMetadata,
): Exclude<ModelType, 'unknown'> | undefined {
  const mode = normalize(model.mode)
  const modeType = mode === undefined ? undefined : classifyValue(mode)
  if (modeType !== undefined) return modeType

  for (const value of [model.type, model.model_type]) {
    const normalized = normalize(value)
    const type = normalized === undefined ? undefined : classifyValue(normalized)
    if (type !== undefined) return type
  }
  return undefined
}

function classifyValue(value: string): Exclude<ModelType, 'unknown'> | undefined {
  if (value.includes(MODEL_MODALITY.Chat) ||
      value.includes(MODEL_MODALITY.Completion) ||
      value.includes(MODEL_MODALITY.Responses)) {
    return MODEL_TYPE.Chat
  }
  if (value.includes(MODEL_MODALITY.Embedding)) return MODEL_TYPE.Embedding
  if (value.includes(MODEL_MODALITY.ImageGeneration) || value.includes(MODEL_MODALITY.Image)) {
    return MODEL_TYPE.Image
  }
  if (value.includes(MODEL_MODALITY.Audio) ||
      value.includes(MODEL_MODALITY.Speech) ||
      value.includes(MODEL_MODALITY.Transcription) ||
      value.includes(MODEL_MODALITY.TextToSpeech)) {
    return MODEL_TYPE.Audio
  }
  return undefined
}

function normalize(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized === '' ? undefined : normalized
}
