import { afterEach, describe, expect, test } from 'bun:test'
import type { Config } from '@opencode-ai/plugin'
import { LiteLLMPlugin } from '../src/index'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('OpenCode model picker discovery', () => {
  test('excludes metadata-free embedding, image, video, and audio routes', async () => {
    let requestCount = 0
    globalThis.fetch = async () => {
      requestCount += 1
      if (requestCount === 1) return Response.json({ data: [] })
      return Response.json({
        object: 'list',
        data: [
          { id: 'chat-model', object: 'model', mode: 'chat' },
          { id: 'multimodal-chat', object: 'model', mode: 'chat', type: 'image' },
          { id: 'cliproxy/gpt-image-chat-compatible', object: 'model', mode: 'chat' },
          { id: 'embedding-model', object: 'model', mode: 'embedding' },
          { id: 'qwen/qwen3-embedding-8b', object: 'model' },
          { id: 'cliproxy/gpt-image-1.5', object: 'model' },
          { id: 'cliproxy/gpt-image-2', object: 'model' },
          { id: 'cliproxy/wan2.2-i2v-flash', object: 'model' },
          { id: 'cliproxy/wan2.2-t2v-plus', object: 'model' },
          { id: 'cliproxy/wan2.2-r2v-flash', object: 'model' },
          { id: 'openai/gpt-4o-mini-tts', object: 'model' },
          { id: 'openai/gpt-4o-transcribe', object: 'model' },
        ],
      })
    }
    const config: Config = {
      provider: {
        litellm: {
          options: { baseURL: 'http://gateway.example.test/v1' },
          models: {},
        },
      },
    }
    const hooks = await LiteLLMPlugin({})

    await hooks.config?.(config)

    expect(Object.keys(config.provider?.litellm?.models ?? {})).toEqual([
      'chat-model',
      'multimodal-chat',
      'cliproxy/gpt-image-chat-compatible',
    ])
    expect(config.provider?.litellm?.models?.['embedding-model']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['qwen/qwen3-embedding-8b']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['cliproxy/gpt-image-1.5']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['cliproxy/gpt-image-2']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['cliproxy/wan2.2-i2v-flash']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['cliproxy/wan2.2-t2v-plus']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['cliproxy/wan2.2-r2v-flash']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['openai/gpt-4o-mini-tts']).toBeUndefined()
    expect(config.provider?.litellm?.models?.['openai/gpt-4o-transcribe']).toBeUndefined()
  })
})
