import { afterEach, describe, expect, test } from 'bun:test'
import type { Config } from '@opencode-ai/plugin'
import type { ServerResponse } from 'node:http'
import { LiteLLMPlugin } from '../src/index'
import { parseMcpServersResponse } from '../src/mcp/client'
import { restoreEnv, startServer } from './search-test-helpers'

const originalKeys = {
  opencode: process.env.OPENCODE_LITELLM_API_KEY,
  litellm: process.env.LITELLM_API_KEY,
  master: process.env.LITELLM_MASTER_KEY,
}
const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  restoreEnv('OPENCODE_LITELLM_API_KEY', originalKeys.opencode)
  restoreEnv('LITELLM_API_KEY', originalKeys.litellm)
  restoreEnv('LITELLM_MASTER_KEY', originalKeys.master)
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('LiteLLM MCP response parsing', () => {
  test.each([
    ['array', [{ server_name: 'zread' }]],
    ['data wrapper', { data: [{ server_name: 'zread' }] }],
    ['mcp_servers wrapper', { mcp_servers: [{ server_name: 'zread' }] }],
  ])('accepts the official %s response', (_label, response) => {
    // Given: an official MCP server response shape
    // When: the response is parsed
    const names = parseMcpServersResponse(response)

    // Then: server names are returned
    expect(names).toEqual(['zread'])
  })

  test('filters malformed rows without rejecting valid servers', () => {
    // Given: a mixed response from the MCP server list endpoint
    const response = [
      null,
      {},
      { server_name: '' },
      { server_name: 'Bad Name' },
      { server_name: 'zread' },
    ]

    // When: the response is parsed
    const names = parseMcpServersResponse(response)

    // Then: only valid SEP-986-compatible names remain
    expect(names).toEqual(['zread'])
  })
})

describe('LiteLLM MCP config registration', () => {
  test('applies include, exclude, enabled overrides, and preserves conflicts', async () => {
    // Given: discovered servers and an explicit conflicting MCP entry
    process.env.OPENCODE_LITELLM_API_KEY = 'runtime-secret'
    const server = await startServer((request, response) => {
      if (request.url === '/model_group/info') {
        sendJson(response, { data: [{ model_group: 'test-model' }] })
        return
      }
      sendJson(response, [
        { server_name: 'minimax_search' },
        { server_name: 'zread' },
        { server_name: 'zai_web_reader' },
        { server_name: 'not_selected' },
      ])
    })
    servers.push(server)
    const explicit = {
      type: 'remote' as const,
      url: 'https://explicit.example/mcp',
      enabled: false,
    }
    const config = configured(server.baseURL, {
      'litellm-zread': explicit,
    })
    const hooks = await LiteLLMPlugin({}, {
      mcpDiscovery: {
        enabled: true,
        include: ['minimax_search', 'zread', 'zai_web_reader'],
        exclude: ['zai_web_reader'],
        servers: [
          { serverName: 'minimax_search', enabled: false },
          { serverName: 'zread', enabled: true },
        ],
        requestTimeoutMs: 15000,
      },
    })

    // When: the config hook performs concurrent discovery
    await hooks.config?.(config)

    // Then: only selected non-conflicting servers are generated safely
    expect(config.mcp?.['litellm-zread']).toBe(explicit)
    expect(config.mcp?.['litellm-minimax-search']).toEqual({
      type: 'remote',
      url: `${server.baseURL}/minimax_search/mcp`,
      enabled: false,
      oauth: false,
      timeout: 15000,
      headers: {
        Authorization: 'Bearer runtime-secret',
      },
    })
    expect(config.mcp?.['litellm-zai-web-reader']).toBeUndefined()
  })

  test('does not create config.mcp when discovery is disabled', async () => {
    // Given: the default plugin options and a working model endpoint
    const server = await startServer((request, response) => {
      sendJson(response, { data: [{ model_group: 'test-model' }] })
    })
    servers.push(server)
    const config = configured(server.baseURL)
    const hooks = await LiteLLMPlugin({})

    // When: the config hook runs
    await hooks.config?.(config)

    // Then: no MCP map is introduced
    expect(config.mcp).toBeUndefined()
  })

  test('requires a resolvable environment credential for generated MCP config', async () => {
    // Given: discovery can use a literal provider key but no safe reference exists
    delete process.env.OPENCODE_LITELLM_API_KEY
    delete process.env.LITELLM_API_KEY
    delete process.env.LITELLM_MASTER_KEY
    const server = await startServer((request, response) => {
      if (request.url === '/model_group/info') {
        sendJson(response, { data: [{ model_group: 'test-model' }] })
        return
      }
      sendJson(response, [{ server_name: 'zread' }])
    })
    servers.push(server)
    const config = configured(server.baseURL, undefined, 'literal-secret')
    const hooks = await LiteLLMPlugin({}, {
      mcpDiscovery: { enabled: true, include: ['zread'] },
    })

    // When: the config hook runs
    await hooks.config?.(config)

    // Then: no secret-bearing MCP entry is generated
    expect(config.mcp).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('Bearer literal-secret')
  })

  test('keeps model and MCP discovery failure-isolated', async () => {
    // Given: one server fails models while another response path supplies MCPs
    process.env.LITELLM_API_KEY = 'runtime-secret'
    const server = await startServer((request, response) => {
      if (request.url === '/v1/mcp/server') {
        sendJson(response, [{ server_name: 'zread' }])
        return
      }
      response.writeHead(500)
      response.end()
    })
    servers.push(server)
    const config = configured(server.baseURL)
    const hooks = await LiteLLMPlugin({}, {
      mcpDiscovery: { enabled: true, include: ['zread'] },
    })

    // When: both discovery flows run
    await hooks.config?.(config)

    // Then: MCP registration survives model failure
    expect(config.mcp?.['litellm-zread']).toBeDefined()
  })

  test('keeps discovered models when MCP discovery fails', async () => {
    // Given: model discovery works while the MCP endpoint fails
    process.env.LITELLM_API_KEY = 'runtime-secret'
    const server = await startServer((request, response) => {
      if (request.url === '/model_group/info') {
        sendJson(response, { data: [{ model_group: 'test-model' }] })
        return
      }
      response.writeHead(500)
      response.end()
    })
    servers.push(server)
    const config = configured(server.baseURL)
    const hooks = await LiteLLMPlugin({}, {
      mcpDiscovery: { enabled: true, include: ['zread'] },
    })

    // When: both discovery flows run
    await hooks.config?.(config)

    // Then: the model merge survives MCP failure
    expect(config.provider?.litellm?.models?.['test-model']).toBeDefined()
  })
})

function configured(
  baseURL: string,
  mcp?: Config['mcp'],
  apiKey = '{env:LITELLM_API_KEY}',
): Config {
  return {
    provider: {
      litellm: {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: `${baseURL}/v1`, apiKey },
        models: {},
      },
    },
    ...(mcp === undefined ? {} : { mcp }),
  }
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
