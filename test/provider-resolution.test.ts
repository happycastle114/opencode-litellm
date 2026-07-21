import { afterEach, describe, expect, test } from 'bun:test'
import { LiteLLMPlugin } from '../src/plugin'
import type { PublicPluginConfig } from '../src/plugin/provider-resolution'

const originalFetch = globalThis.fetch
const originalKeys = {
  openCode: process.env.OPENCODE_LITELLM_API_KEY,
  liteLLM: process.env.LITELLM_API_KEY,
  master: process.env.LITELLM_MASTER_KEY,
} as const

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreEnvironment('OPENCODE_LITELLM_API_KEY', originalKeys.openCode)
  restoreEnvironment('LITELLM_API_KEY', originalKeys.liteLLM)
  restoreEnvironment('LITELLM_MASTER_KEY', originalKeys.master)
})

describe('LiteLLM provider runtime boundary', () => {
  test('replaces malformed provider, options, and models records before model discovery', async () => {
    delete process.env.OPENCODE_LITELLM_API_KEY
    delete process.env.LITELLM_API_KEY
    delete process.env.LITELLM_MASTER_KEY

    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url === 'http://localhost:4000/v1/models') {
        return jsonResponse({ object: 'list', data: [{ id: 'runtime-model' }] })
      }
      if (url === 'http://localhost:4000/model_group/info') {
        return jsonResponse({ data: [{ model_group: 'runtime-model' }] })
      }
      return new Response(null, { status: 404 })
    }

    const config = {
      provider: {
        litellm: {
          preserved: 'provider-field',
          options: 'malformed',
          models: 'malformed',
        },
      },
    } as unknown as PublicPluginConfig

    const hooks = await LiteLLMPlugin({})
    await hooks.config?.(config)

    const provider = config.provider?.litellm as Record<string, unknown>
    expect(provider.preserved).toBe('provider-field')
    expect(provider.options).toEqual({ baseURL: 'http://localhost:4000/v1' })
    expect(provider.models).toEqual({ 'runtime-model': { name: 'Runtime Model' } })
    expect(requests).toContain('http://localhost:4000/v1/models')
    expect(requests).toContain('http://localhost:4000/model_group/info')
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
