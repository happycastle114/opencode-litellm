import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Config } from '@opencode-ai/plugin'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LiteLLMPlugin } from '../src/index'
import { createContext, restoreEnv, startServer } from './search-test-helpers'

const ENVIRONMENT = {
  openCodeKey: 'OPENCODE_LITELLM_API_KEY',
  liteLLMKey: 'LITELLM_API_KEY',
  masterKey: 'LITELLM_MASTER_KEY',
  home: 'HOME',
} as const
const ROUTE = {
  models: '/model_group/info',
  mcp: '/v1/mcp/server',
  search: '/v1/search/agy-search',
} as const
const HTTP_METHOD = { post: 'POST' } as const
const TOKEN = {
  gatewayKey: 'sk-official-runtime-key',
  jwtDecoy: 'jwt-runtime-decoy',
} as const
const SEARCH_RESULT = {
  object: 'search',
  results: [{
    title: 'LiteLLM docs',
    url: 'https://docs.litellm.ai',
    snippet: 'Official documentation',
    date: null,
    last_updated: null,
  }],
} as const

const originalEnvironment = {
  openCodeKey: process.env[ENVIRONMENT.openCodeKey],
  liteLLMKey: process.env[ENVIRONMENT.liteLLMKey],
  masterKey: process.env[ENVIRONMENT.masterKey],
  home: process.env[ENVIRONMENT.home],
}
const servers: Array<{ close: () => Promise<void> }> = []
let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opencode-litellm-runtime-token-'))
  process.env[ENVIRONMENT.home] = directory
  delete process.env[ENVIRONMENT.openCodeKey]
  delete process.env[ENVIRONMENT.liteLLMKey]
  delete process.env[ENVIRONMENT.masterKey]
})

afterEach(async () => {
  restoreEnv(ENVIRONMENT.openCodeKey, originalEnvironment.openCodeKey)
  restoreEnv(ENVIRONMENT.liteLLMKey, originalEnvironment.liteLLMKey)
  restoreEnv(ENVIRONMENT.masterKey, originalEnvironment.masterKey)
  restoreEnv(ENVIRONMENT.home, originalEnvironment.home)
  rmSync(directory, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('OpenCode runtime official LiteLLM credential', () => {
  test('injects the key only in memory for provider, model, MCP, and search discovery', async () => {
    // Given: a provider API URL and an official CLI token issued for its root origin
    const requests: Array<{
      readonly method: string | undefined
      readonly url: string | undefined
      readonly authorization: string | undefined
    }> = []
    const server = await startServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      })
      const payloadByRoute = new Map<string, unknown>([
        [ROUTE.models, { data: [{ model_group: 'test-model' }] }],
        [ROUTE.mcp, [{ server_name: 'zread' }]],
        [ROUTE.search, SEARCH_RESULT],
      ])
      const payload = payloadByRoute.get(request.url ?? '')
      if (payload === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
    })
    servers.push(server)
    const tokenDirectory = join(directory, '.litellm')
    mkdirSync(tokenDirectory, { recursive: true })
    writeFileSync(join(tokenDirectory, 'token.json'), JSON.stringify({
      base_url: server.baseURL,
      key: TOKEN.gatewayKey,
      jwt_token: TOKEN.jwtDecoy,
    }))
    const configPath = join(directory, 'opencode.json')
    const source = JSON.stringify({
      provider: {
        litellm: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: `${server.baseURL}/v1` },
          models: {},
        },
      },
    }, null, 2)
    writeFileSync(configPath, source)
    const config: Config = JSON.parse(source)
    const hooks = await LiteLLMPlugin({}, {
      searchTools: [{
        toolName: 'litellm_search',
        searchToolName: 'agy-search',
      }],
      mcpDiscovery: { enabled: true, include: ['zread'] },
    })

    // When: runtime discovery and a registered search tool use the gateway
    await hooks.config?.(config)
    await hooks.tool?.litellm_search?.execute(
      { query: 'official docs' },
      createContext([]),
    )

    // Then: every runtime surface receives the key and durable config stays secret-free
    const authorizationByRoute = new Map(
      requests.map((request) => [request.url, request.authorization] as const),
    )
    expect(authorizationByRoute.get(ROUTE.models)).toBe(`Bearer ${TOKEN.gatewayKey}`)
    expect(authorizationByRoute.get(ROUTE.mcp)).toBe(`Bearer ${TOKEN.gatewayKey}`)
    expect(authorizationByRoute.get(ROUTE.search)).toBe(`Bearer ${TOKEN.gatewayKey}`)
    expect(requests.find((request) => request.url === ROUTE.search)?.method).toBe(HTTP_METHOD.post)
    expect(config.provider?.litellm?.options?.apiKey).toBe(TOKEN.gatewayKey)
    expect(config.mcp?.['litellm-zread']?.headers?.Authorization).toBe(`Bearer ${TOKEN.gatewayKey}`)
    expect(readFileSync(configPath, 'utf8')).toBe(source)
    expect(readFileSync(configPath, 'utf8')).not.toContain(TOKEN.gatewayKey)
    expect(JSON.stringify(config)).not.toContain(TOKEN.jwtDecoy)
  })
})
