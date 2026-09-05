import { expect, test } from 'bun:test'
import { LiteLLMPlugin } from '../src/index'
import { startServer } from './search-test-helpers'

test('discovers Astra through HTTP into the real plugin without changing an explicit model', async () => {
  // Given: a gateway exposes Astra and a user has an existing model selection
  const server = await startServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: [{ model_group: 'gpt-6-astra', mode: 'responses' }] }))
  })
  const config = {
    model: 'litellm/gpt-5.6-sol',
    provider: { litellm: { options: { baseURL: server.baseURL, apiKey: 'test-only' }, models: {} } },
  }
  try {
    // When: OpenCode invokes the actual public plugin hook
    const hooks = await LiteLLMPlugin({})
    await hooks.config?.(config)
    // Then: its Responses provider exposes Astra, while the selected model survives
    expect(config.model).toBe('litellm/gpt-5.6-sol')
    expect(config.provider.litellm).toMatchObject({ npm: '@ai-sdk/openai', models: {
      'gpt-6-astra': { limit: { context: 1_050_000, output: 128_000 }, variants: { max: { reasoningEffort: 'max' } } },
    } })
  } finally {
    await server.close()
  }
})
