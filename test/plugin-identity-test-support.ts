import type { Config } from '@opencode-ai/plugin'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LiteLLMPlugin } from '../src/index'
import { createContext, restoreEnv, startServer } from './search-test-helpers'

export const ENV = {
  configured: 'PLUGIN_CONFIGURED_KEY',
  missing: 'PLUGIN_MISSING_KEY',
  opencode: 'OPENCODE_LITELLM_API_KEY',
  litellm: 'LITELLM_API_KEY',
  master: 'LITELLM_MASTER_KEY',
  home: 'HOME',
} as const

export const ROUTE = {
  models: '/model_group/info',
  mcp: '/v1/mcp/server',
  search: '/v1/search/agy-search',
} as const

const originalEnv = Object.fromEntries(
  Object.values(ENV).map((name) => [name, process.env[name]]),
) as Record<string, string | undefined>
const servers: Array<{ close: () => Promise<void> }> = []
let homeDirectory = ''

export function setupIdentityTest(): void {
  homeDirectory = mkdtempSync(join(tmpdir(), 'opencode-litellm-identity-'))
  process.env[ENV.home] = homeDirectory
  delete process.env[ENV.configured]
  delete process.env[ENV.missing]
  delete process.env[ENV.opencode]
  delete process.env[ENV.litellm]
  delete process.env[ENV.master]
}

export async function teardownIdentityTest(): Promise<void> {
  for (const [name, value] of Object.entries(originalEnv)) restoreEnv(name, value)
  rmSync(homeDirectory, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map((server) => server.close()))
}

export function setAmbientKeys(): void {
  process.env[ENV.litellm] = 'ambient-api'
  process.env[ENV.master] = 'ambient-master'
}

export async function runSearch(
  hooks: Awaited<ReturnType<typeof LiteLLMPlugin>>,
  query = 'identity',
) {
  return hooks.tool?.litellm_search?.execute({ query }, createContext([]))
}

export function writeOfficialToken(baseURL: string, key = 'official-key'): void {
  const tokenDirectory = join(homeDirectory, '.litellm')
  mkdirSync(tokenDirectory, { recursive: true })
  writeFileSync(join(tokenDirectory, 'token.json'), JSON.stringify({
    base_url: baseURL,
    key,
  }))
}

export function expectAuthorization(
  values: ReadonlyMap<string, string | undefined>,
  key: string,
): void {
  for (const route of Object.values(ROUTE)) {
    expect(values.get(route)).toBe(`Bearer ${key}`)
  }
}

export async function plugin(toolsets: readonly string[] = []) {
  return LiteLLMPlugin({}, {
    searchTools: [{ toolName: 'litellm_search', searchToolName: 'agy-search' }],
    mcpDiscovery: { enabled: true, include: ['zread'] },
    ...(toolsets.length === 0 ? {} : { toolsets }),
  })
}

export function configured(
  baseURL: string,
  apiKey?: string,
  customHeaders?: Readonly<Record<string, string>>,
): Config {
  return {
    provider: {
      litellm: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: `${baseURL}/v1`,
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(customHeaders === undefined ? {} : { customHeaders }),
        },
        models: {},
      },
    },
  }
}

export async function createGatewayServer(
  record: (url: string, authorization?: string) => void,
  requireAuthorization = false,
) {
  const server = await startServer((request, response) => {
    const url = request.url ?? ''
    record(url, request.headers.authorization)
    if (requireAuthorization && request.headers.authorization === undefined) {
      response.writeHead(401)
      response.end()
      return
    }
    if (url === ROUTE.models) {
      sendJson(response, { data: [{ model_group: 'test-model' }] })
      return
    }
    if (url === ROUTE.mcp) {
      sendJson(response, [{ server_name: 'zread' }])
      return
    }
    if (url === ROUTE.search) {
      sendJson(response, {
        object: 'search',
        results: [{
          title: 'Identity',
          url: 'https://example.com/identity',
          snippet: 'identity',
          date: null,
          last_updated: null,
        }],
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  servers.push(server)
  return server
}

function sendJson(response: import('node:http').ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
