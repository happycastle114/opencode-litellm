import { afterEach, describe, expect, test } from 'bun:test'
import type { Config } from '@opencode-ai/plugin'
import { parse as parseJsonc } from 'jsonc-parser'
import { LiteLLMPlugin } from '../src/index'
import {
  applyOpenCodeEdits,
  planOpenCodeEdits,
} from '../src/cli/opencode-config'
import { mergeDiscoveredMcpServers } from '../src/mcp/merge'
import {
  parseMcpDiscoveryOptions,
  parseMcpToolsetOptions,
} from '../src/mcp/options'
import { restoreEnv } from './search-test-helpers'

const originalApiKey = process.env.OPENCODE_LITELLM_API_KEY
const originalFetch = globalThis.fetch

afterEach(async () => {
  restoreEnv('OPENCODE_LITELLM_API_KEY', originalApiKey)
  globalThis.fetch = originalFetch
})

describe('LiteLLM MCP toolset options', () => {
  test('parses selected printable names and rejects duplicate or empty names', () => {
    const options = parseMcpToolsetOptions({
      toolsets: ['research/core', 'ops review'],
    })

    expect(options).toEqual(['research/core', 'ops review'])
    expect(() => parseMcpToolsetOptions({ toolsets: ['research', 'research'] }))
      .toThrow('toolsets')
    expect(() => parseMcpToolsetOptions({ toolsets: [''] })).toThrow('toolsets')
  })
})

describe('OpenCode toolset installer configuration', () => {
  test('writes selected toolsets without runtime URLs or secrets and stays byte-idempotent', () => {
    const intent = {
      baseUrl: 'https://litellm.example.com',
      authEnv: 'LITELLM_API_KEY',
      search: [],
      mcp: [],
      toolsets: ['research/core'],
      disableMcp: [],
    } as const

    const once = applyOpenCodeEdits('{}', planOpenCodeEdits('{}', intent))
    const twice = applyOpenCodeEdits(once, planOpenCodeEdits(once, intent))
    const parsed = parseJsonc(once)

    expect(parsed.plugin[0][1].toolsets).toEqual(['research/core'])
    expect(once).not.toContain('/toolset/')
    expect(once).not.toContain('Bearer ')
    expect(twice).toBe(once)
  })
})

describe('LiteLLM MCP toolset runtime registration', () => {
  test('normalizes arbitrary names, suffixes slug collisions, and deduplicates exact names', () => {
    const config: Config = {}
    const options = parseMcpDiscoveryOptions({
      mcpDiscovery: { enabled: true, requestTimeoutMs: 15000 },
    })

    const first = mergeDiscoveredMcpServers({
      config,
      baseURL: 'https://litellm.example.com',
      serverNames: [],
      toolsets: ['team/alpha', 'team alpha', 'team-alpha', 'team/alpha'],
      options,
      authorization: 'Bearer runtime-secret',
    })
    const once = JSON.stringify(config)
    const second = mergeDiscoveredMcpServers({
      config,
      baseURL: 'https://litellm.example.com',
      serverNames: [],
      toolsets: ['team/alpha', 'team alpha', 'team-alpha', 'team/alpha'],
      options,
      authorization: 'Bearer runtime-secret',
    })

    expect(first).toBe(3)
    expect(second).toBe(0)
    expect(Object.keys(config.mcp ?? {})).toEqual([
      'litellm-toolset-team-alpha',
      'litellm-toolset-team-alpha-2',
      'litellm-toolset-team-alpha-3',
    ])
    expect(config.mcp?.['litellm-toolset-team-alpha-2']?.url).toBe(
      'https://litellm.example.com/toolset/team%20alpha/mcp',
    )
    expect(JSON.stringify(config)).toBe(once)
  })

  test('registers URL-encoded toolsets with in-memory authorization alongside dynamic servers', async () => {
    process.env.OPENCODE_LITELLM_API_KEY = 'runtime-secret'
    const baseURL = 'https://litellm.example.com'
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname
      return path === '/v1/mcp/server'
        ? Response.json([{ server_name: 'zread' }])
        : Response.json({ data: [{ model_group: 'test-model' }] })
    }
    const config: Config = configured(baseURL)
    const hooks = await LiteLLMPlugin({}, {
      toolsets: ['research/core'],
      mcpDiscovery: { enabled: true, include: ['zread'] },
    })

    await hooks.config?.(config)
    const first = JSON.stringify(config)
    await hooks.config?.(config)

    expect(Object.values(config.mcp ?? {})).toEqual(expect.arrayContaining([
      {
        type: 'remote',
        url: `${baseURL}/toolset/research%2Fcore/mcp`,
        enabled: true,
        oauth: false,
        timeout: 15000,
        headers: { Authorization: 'Bearer runtime-secret' },
      },
      {
        type: 'remote',
        url: `${baseURL}/zread/mcp`,
        enabled: true,
        oauth: false,
        timeout: 15000,
        headers: { Authorization: 'Bearer runtime-secret' },
      },
    ]))
    expect(JSON.stringify(config)).toBe(first)
  })

  test('does not register a toolset from an unresolved literal provider key', async () => {
    delete process.env.OPENCODE_LITELLM_API_KEY
    globalThis.fetch = async () => Response.json({ data: [{ model_group: 'test-model' }] })
    const config = configured('https://litellm.example.com', 'literal-secret')
    const hooks = await LiteLLMPlugin({}, { toolsets: ['research'] })

    await hooks.config?.(config)

    expect(config.mcp).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('Bearer literal-secret')
  })
})

function configured(baseURL: string, apiKey = '{env:OPENCODE_LITELLM_API_KEY}'): Config {
  return {
    provider: {
      litellm: {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: `${baseURL}/v1`, apiKey },
        models: {},
      },
    },
  }
}
