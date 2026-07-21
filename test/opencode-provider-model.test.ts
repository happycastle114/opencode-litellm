import { describe, expect, test } from 'bun:test'
import {
  buildOpenCodeProviderModels,
  toOpenCodeProviderModel,
} from '../src/cli/opencode-provider-model'

describe('OpenCode provider model snapshots', () => {
  test('converts typed chat metadata into an immediate picker entry', () => {
    // Given: a discovered multimodal tool-capable chat model
    const model = {
      id: 'alibaba-token/qwen3.8-max-preview',
      mode: 'chat',
      max_input_tokens: 1_000_000,
      max_output_tokens: 65_536,
      supports_function_calling: true,
      supports_vision: true,
    } as const

    // When: the installer builds the static provider entry
    const entry = toOpenCodeProviderModel(model)

    // Then: stable discovery metadata is represented without a credential
    expect(entry).toEqual({
      name: 'Qwen3.8 Max Preview',
      limit: { context: 1_000_000, output: 65_536 },
      tool_call: true,
      attachment: true,
    })
  })

  test('filters endpoint-specific routes from the static chat registry', () => {
    const models = buildOpenCodeProviderModels([
      { id: 'chat-model', mode: 'chat' },
      { id: 'embedding-model', mode: 'embedding' },
      { id: 'cliproxy/gpt-image-2' },
      { id: 'openai/gpt-4o-mini-tts' },
    ])

    expect(Object.keys(models)).toEqual(['chat-model'])
    expect(models['embedding-model']).toBeUndefined()
    expect(models['cliproxy/gpt-image-2']).toBeUndefined()
    expect(models['openai/gpt-4o-mini-tts']).toBeUndefined()
  })
})
