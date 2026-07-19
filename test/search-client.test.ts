import { afterEach, describe, expect, test } from 'bun:test'
import { resolveSearchApiKey } from '../src/search/client'

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
  test('prefers the OpenCode-specific key', () => {
    // Given: every supported environment key is set
    process.env.OPENCODE_LITELLM_API_KEY = 'opencode'
    process.env.LITELLM_API_KEY = 'litellm'
    process.env.LITELLM_MASTER_KEY = 'master'

    // When: search authentication is resolved
    const key = resolveSearchApiKey('configured')

    // Then: the OpenCode-specific key wins
    expect(key).toBe('opencode')
  })

  test.each([
    ['LiteLLM key', 'litellm', 'master', 'litellm'],
    ['master key', undefined, 'master', 'master'],
    ['configured key', undefined, undefined, 'configured'],
  ])('falls back to the %s', (_label, litellmKey, masterKey, expected) => {
    // Given: higher-priority key sources are absent
    delete process.env.OPENCODE_LITELLM_API_KEY
    restoreEnv('LITELLM_API_KEY', litellmKey)
    restoreEnv('LITELLM_MASTER_KEY', masterKey)

    // When: search authentication is resolved
    const key = resolveSearchApiKey('configured')

    // Then: the next documented source is selected
    expect(key).toBe(expected)
  })

  test('resolves an exact configured environment placeholder', () => {
    // Given: standard keys are absent and the configured variable exists
    clearStandardKeys()
    process.env.SEARCH_CONFIGURED_KEY = 'resolved-key'

    // When: the exact OpenCode placeholder is resolved
    const key = resolveSearchApiKey('{env:SEARCH_CONFIGURED_KEY}')

    // Then: the environment value is returned
    expect(key).toBe('resolved-key')
  })

  test('returns undefined when the configured placeholder variable is missing', () => {
    // Given: neither standard keys nor the configured variable exist
    clearStandardKeys()
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
    // Given: a variable exists but the configured value is not an exact env placeholder
    clearStandardKeys()
    process.env.SEARCH_CONFIGURED_KEY = 'resolved-key'

    // When: the configured value is resolved
    const key = resolveSearchApiKey(configuredKey)

    // Then: arbitrary template syntax is not accepted as a bearer token
    expect(key).toBeUndefined()
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function clearStandardKeys(): void {
  delete process.env.OPENCODE_LITELLM_API_KEY
  delete process.env.LITELLM_API_KEY
  delete process.env.LITELLM_MASTER_KEY
}
