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

  test('adds discovered models while preserving curated and stale snapshot entries', () => {
    // Given: one curated collision, one prior snapshot, and fresh discovery
    const source = JSON.stringify({
      provider: {
        litellm: {
          models: {
            'gateway/model-a': { name: 'My curated A', temperature: 0.2 },
            'stale-snapshot': { name: 'Stale but preserved' },
          },
        },
      },
    })
    const intent = {
      ...baseIntent,
      models: [
        { id: 'gateway/model-a', mode: 'chat' },
        { id: 'gateway/model-b', mode: 'chat' },
      ],
    } as const

    // When: installer discovery is merged into the static provider registry
    const parsed = parseJsonc(render(source, intent))

    // Then: user entries win, fresh IDs appear, and unmarked stale rows are not guessed away
    expect(parsed.provider.litellm.models).toEqual({
      'gateway/model-b': { name: 'Model B' },
      'gateway/model-a': { name: 'My curated A', temperature: 0.2 },
      'stale-snapshot': { name: 'Stale but preserved' },
    })
  })

  test('retires the six-model Alibaba legacy whitelist without changing user blacklist entries', () => {
    // Given: the legacy sync fingerprint that restricted OpenCode to six Alibaba rows
    const legacyWhitelist = [
      'alibaba-token/qwen3.8-max-preview',
      'alibaba-token/deepseek-v4-pro',
      'alibaba-token/qwen3.7-plus',
      'alibaba-token/glm-5.2',
      'alibaba-token/qwen3.7-max',
      'alibaba-token/qwen3.6-flash',
    ] as const
    const source = JSON.stringify({
      provider: {
        litellm: {
          whitelist: legacyWhitelist,
          blacklist: ['blocked-by-user'],
          models: { 'curated-model': { name: 'Curated model' } },
        },
      },
    })
    const intent = {
      ...baseIntent,
      models: [...legacyWhitelist, 'gateway/new-chat'].map((id) => ({ id, mode: 'chat' })),
    } as const

    // When: the installer refreshes the provider from authenticated discovery
    const provider = parseJsonc(render(source, intent)).provider.litellm

    // Then: the stale toolkit gate is gone while user policy and all chat rows remain
    expect(provider.whitelist).toBeUndefined()
    expect(provider.blacklist).toEqual(['blocked-by-user'])
    expect(Object.keys(provider.models)).toEqual([
      ...legacyWhitelist,
      'gateway/new-chat',
      'curated-model',
    ])
  })

  test('preserves a non-legacy user whitelist', () => {
    const source = JSON.stringify({
      provider: { litellm: { whitelist: ['team-approved-model'] } },
    })

    const provider = parseJsonc(render(source, {
      ...baseIntent,
      models: [{ id: 'gateway/new-chat', mode: 'chat' }],
    } as const)).provider.litellm

    expect(provider.whitelist).toEqual(['team-approved-model'])
  })

  test('preserves a custom six-model Alibaba whitelist', () => {
    // Given: a user policy that differs from the legacy fingerprint by one model
    const customWhitelist = [
      'alibaba-token/deepseek-v4-pro',
      'alibaba-token/glm-5.2',
      'alibaba-token/qwen3.6-flash',
      'alibaba-token/qwen3.7-max',
      'alibaba-token/qwen3.7-plus',
      'alibaba-token/team-private-model',
    ] as const
    const source = JSON.stringify({
      provider: { litellm: { whitelist: customWhitelist } },
    })

    // When: installer discovery refreshes the provider
    const provider = parseJsonc(render(source, {
      ...baseIntent,
      models: [{ id: 'gateway/new-chat', mode: 'chat' }],
    } as const)).provider.litellm

    // Then: the near-match remains user-owned policy
    expect(provider.whitelist).toEqual(customWhitelist)
  })
})
