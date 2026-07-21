import { describe, expect, test } from 'bun:test'
import { formatModelName } from '../src/utils/format-model-name'

describe('formatModelName', () => {
  test('uses the verified Qwen3.8 display name for the Alibaba Token model', () => {
    // Given: the exact Qwen model id exposed by the LiteLLM gateway
    const model = {
      id: 'alibaba-token/qwen3.8-max-preview',
      object: 'model',
    }

    // When: OpenCode builds the model picker display name
    const displayName = formatModelName(model)

    // Then: the verified product spelling is preserved
    expect(displayName).toBe('Qwen3.8 Max Preview')
  })

  test('keeps generic formatting for other model ids', () => {
    // Given: an unrelated provider-prefixed model id
    const model = {
      id: 'openai/gpt-4o-mini',
      object: 'model',
    }

    // When: the generic formatter handles the model
    const displayName = formatModelName(model)

    // Then: existing generic formatting remains unchanged
    expect(displayName).toBe('GPT 4o Mini')
  })
})
