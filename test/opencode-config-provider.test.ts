import { describe, expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  OH_MY_OPENAGENT_PLUGIN_SPEC,
  PLUGIN_SPEC,
  baseIntent,
  render,
} from './opencode-config-test-support'

describe('opencode provider editing', () => {
  test('creates provider and plugin in an empty config', () => {
    const output = render('{}')
    const parsed = parseJsonc(output)

    expect(parsed.provider.litellm).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'LiteLLM',
      options: {
        baseURL: 'https://litellm.example.com/v1',
        apiKey: '{env:LITELLM_API_KEY}',
      },
    })
    expect(parsed.plugin).toEqual([PLUGIN_SPEC, OH_MY_OPENAGENT_PLUGIN_SPEC])
  })

  test('writes only an env reference and never a secret value', () => {
    const output = render('{}')

    expect(output).toContain('{env:LITELLM_API_KEY}')
    expect(output).not.toContain('sk-')
  })

  test('normalizes a trailing slash origin to a single /v1 suffix', () => {
    const intent = { ...baseIntent, baseUrl: 'https://litellm.example.com/' } as const
    const parsed = parseJsonc(render('{}', intent))

    expect(parsed.provider.litellm.options.baseURL).toBe('https://litellm.example.com/v1')
  })

  test('preserves curated provider fields, models, and options while refreshing managed fields', () => {
    const source = JSON.stringify({
      provider: {
        litellm: {
          npm: '@old/provider',
          name: 'Old managed name',
          timeout: 45_000,
          models: {
            'curated-model': { name: 'Curated model', limit: { context: 1234 } },
          },
          options: {
            baseURL: 'https://old.example/v1',
            apiKey: '{env:OLD_KEY}',
            customHeaders: { 'CF-Access-Client-Id': 'preserved-client' },
            timeout: 12_000,
          },
        },
      },
    })
    const parsed = parseJsonc(render(source))

    expect(parsed.provider.litellm).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'LiteLLM',
      timeout: 45_000,
      models: {
        'curated-model': { name: 'Curated model', limit: { context: 1234 } },
      },
      options: {
        baseURL: 'https://litellm.example.com/v1',
        apiKey: '{env:LITELLM_API_KEY}',
        customHeaders: { 'CF-Access-Client-Id': 'preserved-client' },
        timeout: 12_000,
      },
    })
  })
})
