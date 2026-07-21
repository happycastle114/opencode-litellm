import { describe, expect, test } from 'bun:test'
import type { LiteLLMModel } from '../src/types'
import { classifyModel, MODEL_TYPE } from '../src/utils/model-modality'

describe('model modality classification', () => {
  test('classifies metadata-free LiteLLM model rows by conservative route ids', () => {
    // Given: standard /v1/models rows that do not include LiteLLM modality metadata
    const models: readonly LiteLLMModel[] = [
      { id: 'qwen/qwen3-embedding-8b', object: 'model', created: 1, owned_by: 'qwen' },
      { id: 'cliproxy/gpt-image-1.5', object: 'model', created: 2, owned_by: 'cliproxy' },
      { id: 'cliproxy/gpt-image-2', object: 'model', created: 3, owned_by: 'cliproxy' },
      { id: 'cliproxy/wan2.2-i2v-flash', object: 'model', created: 4, owned_by: 'cliproxy' },
      { id: 'cliproxy/wan2.2-t2v-plus', object: 'model', created: 5, owned_by: 'cliproxy' },
      { id: 'cliproxy/wan2.2-r2v-flash', object: 'model', created: 6, owned_by: 'cliproxy' },
      { id: 'openai/gpt-4o-mini-tts', object: 'model', created: 7, owned_by: 'openai' },
      { id: 'openai/gpt-4o-transcribe', object: 'model', created: 8, owned_by: 'openai' },
    ]

    // When: the shared classifier inspects the rows
    const types = models.map((model) => classifyModel(model))

    // Then: endpoint-specific routes are kept out of chat model pickers
    expect(types).toEqual([
      MODEL_TYPE.Embedding,
      MODEL_TYPE.Image,
      MODEL_TYPE.Image,
      MODEL_TYPE.Image,
      MODEL_TYPE.Image,
      MODEL_TYPE.Image,
      MODEL_TYPE.Audio,
      MODEL_TYPE.Audio,
    ])
  })

  test('keeps explicit chat transport metadata authoritative over image-looking ids', () => {
    // Given: chat-capable models whose ids resemble image routes
    const models: readonly LiteLLMModel[] = [
      { id: 'cliproxy/gpt-image-chat-compatible', object: 'model', mode: 'chat' },
      { id: 'cliproxy/gpt-image-completion-compatible', object: 'model', mode: 'completion' },
      { id: 'cliproxy/gpt-image-responses-compatible', object: 'model', mode: 'responses' },
    ]

    // When: the shared classifier inspects metadata before the id fallback
    const types = models.map((model) => classifyModel(model))

    // Then: every explicit chat transport contract wins
    expect(types).toEqual([MODEL_TYPE.Chat, MODEL_TYPE.Chat, MODEL_TYPE.Chat])
  })
})
