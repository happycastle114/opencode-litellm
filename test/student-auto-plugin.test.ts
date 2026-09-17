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
    small_model: 'litellm/gpt-5.6-sol',
    ...(selected === undefined ? {} : { model: selected }),
    provider: { litellm: { options: { baseURL: server.baseURL, apiKey: 'test-only' }, models: { 'old-classifier': { name: 'retired' } } } },
  }
  try {
    // When: the actual public plugin initializes the OpenCode configuration
    const hooks = await LiteLLMPlugin({})
    await hooks.config?.(config)
    // Then: unauthorized entries disappear, native Responses remains, direct choices survive
    expect(config.model).toBe(expected)
    expect(config.small_model).toBe('litellm/gpt-5.6-luna')
    expect(Object.keys(config.provider.litellm.models).sort()).toEqual([...ids].sort())
    expect(config.provider.litellm).toMatchObject({ npm: '@ai-sdk/openai' })
  } finally {
    await server.close()
  }
})

test.each([
  { selected: 'openai/gpt-6-astra', small: 'openai/gpt-5.6-luna' },
  { selected: 'openai/gpt-6-astra', small: undefined },
  { selected: 'litellm/gpt-5.6-terra', small: 'anthropic/claude-haiku' },
])('preserves unrelated provider defaults for %j', async ({ selected, small }) => {
  // Given: a student gateway is configured alongside native provider defaults.
  const server = await startServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: ids.map((model_group) => ({ model_group, mode: 'responses' })) }))
  })
  const config = {
    model: selected,
    small_model: small,
    provider: { litellm: { options: { baseURL: server.baseURL, apiKey: 'test-only' }, models: {} } },
  }
  try {
    // When: the public plugin discovers the authorized gateway catalog.
    const hooks = await LiteLLMPlugin({})
    await hooks.config?.(config)
    // Then: neither an explicit native default nor native automatic selection is replaced.
    expect({ model: config.model, small_model: config.small_model }).toEqual({ model: selected, small_model: small })
    expect(Object.keys(config.provider.litellm.models).sort()).toEqual([...ids].sort())
  } finally {
    await server.close()
  }
})
