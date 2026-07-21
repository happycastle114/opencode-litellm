import { afterEach, describe, expect, test } from 'bun:test'
import { LiteLLMPlugin } from '../src/index'
import {
  SEARCH_RESULTS,
  SEARCH_TOOL,
  captureSearch,
  clearKeys,
  configuredPlugin,
  createContext,
  restoreEnv,
  sendModels,
  startServer,
  type CapturedRequest,
  type MetadataUpdate,
} from './search-test-helpers'

const originalKeys = {
  opencode: process.env.OPENCODE_LITELLM_API_KEY,
  litellm: process.env.LITELLM_API_KEY,
  master: process.env.LITELLM_MASTER_KEY,
}

afterEach(() => {
  restoreEnv('OPENCODE_LITELLM_API_KEY', originalKeys.opencode)
  restoreEnv('LITELLM_API_KEY', originalKeys.litellm)
  restoreEnv('LITELLM_MASTER_KEY', originalKeys.master)
})

describe('configured LiteLLM search tools', () => {
  test('preserves existing model discovery behavior', async () => {
    // Given: search tools and a LiteLLM provider are configured together
    clearKeys()
    const server = await startServer((_request, response) => sendModels(response))
    const config = {
      provider: {
        litellm: {
          options: { baseURL: `${server.baseURL}/v1` },
          models: {},
        },
      },
    }

    try {
      const hooks = await LiteLLMPlugin({}, { searchTools: [SEARCH_TOOL] })

      // When: the existing config hook performs discovery
      await hooks.config?.(config)

      // Then: the discovered model is injected exactly as before
      expect(config.provider.litellm.models).toEqual({
        'test-model': { name: 'Test Model' },
      })
    } finally {
      await server.close()
    }
  })

  test('posts to the normalized named route and returns OpenCode metadata', async () => {
    // Given: a provider URL ending in /v1 and all supported key variables
    process.env.OPENCODE_LITELLM_API_KEY = 'opencode-key'
    process.env.LITELLM_API_KEY = 'litellm-key'
    process.env.LITELLM_MASTER_KEY = 'master-key'
    const requests: CapturedRequest[] = []
    const server = await startServer((request, response) => {
      if (request.method === 'GET') return sendModels(response)
      void captureSearch(request, response, requests)
    })

    try {
      const hooks = await configuredPlugin(server.baseURL, {
        toolName: 'litellm_search',
        searchToolName: 'agy-search',
        defaultMaxResults: 4,
      })
      const metadata: MetadataUpdate[] = []
      const context = createContext(metadata)

      // When: OpenCode executes the non-reserved LiteLLM search tool
      const result = await hooks.tool?.litellm_search?.execute(
        { query: 'current LiteLLM docs', search_domain_filter: ['docs.litellm.ai'] },
        context,
      )

      // Then: the request and result follow the LiteLLM/OpenCode contracts
      expect(requests).toEqual([
        {
          url: '/v1/search/agy-search',
          authorization: 'Bearer opencode-key',
          contentType: 'application/json',
          cfAccessClientId: undefined,
          body: {
            query: 'current LiteLLM docs',
            max_results: 4,
            search_domain_filter: ['docs.litellm.ai'],
          },
        },
      ])
      expect(metadata).toEqual([
        { title: 'Web search: current LiteLLM docs', metadata: { resultCount: 1 } },
      ])
      expect(result).toEqual({
        output: JSON.stringify(SEARCH_RESULTS, null, 2),
        metadata: { resultCount: 1 },
      })
    } finally {
      await server.close()
    }
  })

  test('propagates custom headers without allowing protected overrides', async () => {
    // Given: gateway headers include conflicting authorization and content type values
    process.env.OPENCODE_LITELLM_API_KEY = 'authoritative-key'
    const requests: CapturedRequest[] = []
    const server = await startServer((request, response) => {
      if (request.method === 'GET') return sendModels(response)
      void captureSearch(request, response, requests)
    })

    try {
      const hooks = await configuredPlugin(server.baseURL, SEARCH_TOOL, {
        customHeaders: {
          'CF-Access-Client-Id': 'cf-client-id',
          authorization: 'Bearer custom-key',
          'content-type': 'text/plain',
        },
      })

      // When: the configured search tool executes
      await hooks.tool?.search?.execute({ query: 'query' }, createContext([]))

      // Then: the gateway header is sent and plugin security headers remain authoritative
      expect(requests).toEqual([
        {
          url: '/v1/search/agy-search',
          authorization: 'Bearer authoritative-key',
          contentType: 'application/json',
          cfAccessClientId: 'cf-client-id',
          body: { query: 'query', max_results: 10 },
        },
      ])
    } finally {
      await server.close()
    }
  })

  test('fails closed when no API key is available', async () => {
    // Given: a configured provider without any usable search credential
    clearKeys()
    const server = await startServer((_request, response) => sendModels(response))

    try {
      const hooks = await configuredPlugin(server.baseURL, SEARCH_TOOL)

      // When/Then: execution stops before a search request is sent
      await expect(
        hooks.tool?.search?.execute({ query: 'query' }, createContext([])),
      ).rejects.toThrow('API key')
    } finally {
      await server.close()
    }
  })

  test.each([
    ['non-2xx response', 502, { error: 'upstream included secret-key' }],
    ['malformed response', 200, { object: 'search', results: [{ title: 'missing fields' }] }],
  ])('fails closed on a %s without exposing the bearer token', async (_label, status, body) => {
    // Given: a search endpoint returning an untrusted failure payload
    process.env.OPENCODE_LITELLM_API_KEY = 'secret-key'
    const server = await startServer((request, response) => {
      if (request.method === 'GET') return sendModels(response)
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })

    try {
      const hooks = await configuredPlugin(server.baseURL, SEARCH_TOOL)

      // When/Then: the sanitized error excludes response content and credentials
      await expect(
        hooks.tool?.search?.execute({ query: 'query' }, createContext([])),
      ).rejects.not.toThrow('secret-key')
    } finally {
      await server.close()
    }
  })

  test('respects the OpenCode abort signal', async () => {
    // Given: an already-cancelled tool execution
    process.env.OPENCODE_LITELLM_API_KEY = 'secret-key'
    const server = await startServer((_request, response) => sendModels(response))
    const controller = new AbortController()
    controller.abort()

    try {
      const hooks = await configuredPlugin(server.baseURL, SEARCH_TOOL)

      // When/Then: the client reports a sanitized cancellation failure
      await expect(
        hooks.tool?.search?.execute({ query: 'query' }, createContext([], controller.signal)),
      ).rejects.toThrow('aborted')
    } finally {
      await server.close()
    }
  })

  test('fails closed on a network error without exposing the bearer token', async () => {
    // Given: a provider that becomes unavailable after plugin configuration
    process.env.OPENCODE_LITELLM_API_KEY = 'secret-key'
    const server = await startServer((_request, response) => sendModels(response))
    const hooks = await configuredPlugin(server.baseURL, SEARCH_TOOL)
    await server.close()

    // When/Then: the connection failure is sanitized
    const failure = hooks.tool?.search?.execute(
      { query: 'query' },
      createContext([]),
    )
    await expect(failure).rejects.toThrow('network request failed')
    await expect(failure).rejects.not.toThrow('secret-key')
  })
})
