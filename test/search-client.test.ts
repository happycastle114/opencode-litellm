import { afterEach, describe, expect, test } from 'bun:test'
import { resolveSearchApiKey, searchLiteLLM } from '../src/search/client'
import { startServer } from './search-test-helpers'

const originalKeys = {
  opencode: process.env.OPENCODE_LITELLM_API_KEY,
  litellm: process.env.LITELLM_API_KEY,
  master: process.env.LITELLM_MASTER_KEY,
  configured: process.env.SEARCH_CONFIGURED_KEY,
}

afterEach(() => {
  restoreEnv('OPENCODE_LITELLM_API_KEY', originalKeys.opencode)
  restoreEnv('LITELLM_API_KEY', originalKeys.litellm)
  restoreEnv('LITELLM_MASTER_KEY', originalKeys.master)
  restoreEnv('SEARCH_CONFIGURED_KEY', originalKeys.configured)
})

describe('LiteLLM search API key resolution', () => {
  test('prefers a configured literal key over standard ambient keys', () => {
    // Given: a configured provider key and every standard fallback
    process.env.OPENCODE_LITELLM_API_KEY = 'opencode'
    process.env.LITELLM_API_KEY = 'litellm'
    process.env.LITELLM_MASTER_KEY = 'master'

    // When: search authentication is resolved
    const key = resolveSearchApiKey('configured')

    // Then: the configured provider identity wins
    expect(key).toBe('configured')
  })

  test.each([
    ['OpenCode key', 'opencode', 'litellm', 'master', 'opencode'],
    ['LiteLLM key', undefined, 'litellm', 'master', 'litellm'],
    ['master key', undefined, undefined, 'master', 'master'],
  ])('falls back to the %s only when no provider key is configured', (
    _label,
    openCodeKey,
    litellmKey,
    masterKey,
    expected,
  ) => {
    // Given: higher-priority key sources are absent
    restoreEnv('OPENCODE_LITELLM_API_KEY', openCodeKey)
    restoreEnv('LITELLM_API_KEY', litellmKey)
    restoreEnv('LITELLM_MASTER_KEY', masterKey)

    // When: search authentication is resolved
    const key = resolveSearchApiKey()

    // Then: the next documented source is selected
    expect(key).toBe(expected)
  })

  test('resolves an exact configured environment placeholder', () => {
    // Given: the configured variable and a more privileged ambient fallback exist
    process.env.LITELLM_MASTER_KEY = 'ambient-master'
    process.env.SEARCH_CONFIGURED_KEY = 'resolved-key'

    // When: the exact OpenCode placeholder is resolved
    const key = resolveSearchApiKey('{env:SEARCH_CONFIGURED_KEY}')

    // Then: the environment value is returned
    expect(key).toBe('resolved-key')
  })

  test('returns undefined when the configured placeholder variable is missing', () => {
    // Given: the configured variable is missing while an ambient fallback exists
    process.env.LITELLM_MASTER_KEY = 'ambient-master'
    delete process.env.SEARCH_CONFIGURED_KEY

    // When: the exact placeholder is resolved
    const key = resolveSearchApiKey('{env:SEARCH_CONFIGURED_KEY}')

    // Then: the unresolved placeholder is not used as a bearer token
    expect(key).toBeUndefined()
  })

  test.each([
    '{env:SEARCH_CONFIGURED_KEY}/suffix',
    'prefix-{env:SEARCH_CONFIGURED_KEY}',
    '{file:/tmp/key}',
    '${SEARCH_CONFIGURED_KEY}',
  ])('rejects non-exact configured template syntax: %s', (configuredKey) => {
    // Given: a variable and ambient fallback exist but the configured syntax is invalid
    process.env.LITELLM_MASTER_KEY = 'ambient-master'
    process.env.SEARCH_CONFIGURED_KEY = 'resolved-key'

    // When: the configured value is resolved
    const key = resolveSearchApiKey(configuredKey)

    // Then: arbitrary template syntax is not accepted as a bearer token
    expect(key).toBeUndefined()
  })
})

describe('LiteLLM search response compatibility', () => {
  test('normalizes omitted optional date fields to null', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        object: 'search',
        results: [{
          title: 'LiteLLM docs',
          url: 'https://docs.litellm.ai/docs/search',
          snippet: 'Official Search API documentation',
        }],
      }))
    })

    try {
      const result = await searchLiteLLM({
        endpoint: { baseURL: server.baseURL, apiKey: 'fixture-key' },
        searchToolName: 'search',
        request: { query: 'LiteLLM', max_results: 1 },
        signal: new AbortController().signal,
      })

      expect(result.results).toEqual([{
        title: 'LiteLLM docs',
        url: 'https://docs.litellm.ai/docs/search',
        snippet: 'Official Search API documentation',
        date: null,
        last_updated: null,
      }])
    } finally {
      await server.close()
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
