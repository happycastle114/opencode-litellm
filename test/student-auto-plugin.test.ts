import { expect, test } from 'bun:test'
import { LiteLLMPlugin } from '../src/index'
import { startServer } from './search-test-helpers'

const ids = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra']

test.each([
  [undefined, 'litellm/student-auto'],
  ['litellm/gpt-5.6-sol', 'litellm/student-auto'],
  ['litellm/gpt-5.6-terra', 'litellm/gpt-5.6-terra'],
])('uses scoped discovery to resolve selected model %s', async (selected, expected) => {
  // Given: the HTTP gateway exposes only the four authorized student routes
  const server = await startServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: ids.map((model_group) => ({ model_group, mode: 'responses' })) }))
  })
  const config = {
    ...(selected === undefined ? {} : { model: selected }),
    provider: { litellm: { options: { baseURL: server.baseURL, apiKey: 'test-only' }, models: { 'old-classifier': { name: 'retired' } } } },
  }
  try {
    // When: the actual public plugin initializes the OpenCode configuration
    const hooks = await LiteLLMPlugin({})
    await hooks.config?.(config)
    // Then: unauthorized entries disappear, native Responses remains, direct choices survive
    expect(config.model).toBe(expected)
    expect(Object.keys(config.provider.litellm.models).sort()).toEqual([...ids].sort())
    expect(config.provider.litellm).toMatchObject({ npm: '@ai-sdk/openai' })
  } finally {
    await server.close()
  }
})
