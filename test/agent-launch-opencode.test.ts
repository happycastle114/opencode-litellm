import { describe, expect, test } from 'bun:test'
import { launchAgent } from '../src/cli/agent-launch'
import { boundaryFor, type CapturedAgentCall } from './agent-launch-test-support'

describe('direct LiteLLM agent launcher', () => {
  test('launches OpenCode with a child-scoped token and scrubs ambient Exa', () => {
    // Given: an OpenCode process inheriting stale secret variables
    const calls: CapturedAgentCall[] = []
    const environment = {
      LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
      LITELLM_API_KEY: 'ambient-litellm-key',
      LITELLM_MASTER_KEY: 'ambient-master-key',
      OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key',
      OPENCODE_CONFIG: '/tmp/ambient/opencode.json',
      OPENCODE_CONFIG_DIR: '/tmp/ambient',
      OPENCODE_ENABLE_EXA: 'true',
      CUSTOM_GATEWAY_KEY: 'ambient-custom-key',
      ANTHROPIC_API_KEY: 'ambient-anthropic-key',
      OPENAI_API_KEY: 'ambient-openai-key',
      TRACE_ID: 'preserved-trace',
    } as const

    // When: OpenCode is launched through the managed plugin/token path
    launchAgent({
      command: 'opencode',
      args: ['--help'],
      gatewayOrigin: 'https://llm.example.com/',
      apiKey: 'transient-gateway-key',
      authEnv: 'CUSTOM_GATEWAY_KEY',
      environment,
    }, boundaryFor(calls))

    // Then: gateway context and the managed token are child-scoped
    expect(calls[0]?.file).toBe('opencode')
    expect(calls[0]?.args).toEqual(['--help'])
    expect(calls[0]?.options.env.LITELLM_PROXY_URL).toBe('https://llm.example.com')
    expect(calls[0]?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.CUSTOM_GATEWAY_KEY).toBe('transient-gateway-key')
    expect(calls[0]?.options.env.OPENCODE_LITELLM_API_KEY).toBe('transient-gateway-key')
    expect(calls[0]?.options.env.OPENCODE_ENABLE_EXA).toBeUndefined()
    expect(calls[0]?.options.env.OPENCODE_CONFIG).toBeUndefined()
    expect(calls[0]?.options.env.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(calls[0]?.options.env.ANTHROPIC_API_KEY).toBe('ambient-anthropic-key')
    expect(calls[0]?.options.env.OPENAI_API_KEY).toBe('ambient-openai-key')
    expect(calls[0]?.options.env.TRACE_ID).toBe('preserved-trace')
    expect(calls[0]?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(environment.CUSTOM_GATEWAY_KEY).toBe('ambient-custom-key')
    expect(environment.OPENCODE_LITELLM_API_KEY).toBe('ambient-opencode-key')
  })

  test('launches OpenCode with matching custom config file and directory state', () => {
    // Given: stale OpenCode overrides, an enabled ambient Exa flag, and an unrelated variable
    const calls: CapturedAgentCall[] = []

    // When: a custom config file is launched
    launchAgent({
      command: 'opencode',
      args: [],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-key',
      configPath: '/tmp/managed/config/opencode.jsonc',
      environment: {
        OPENCODE_CONFIG: '/tmp/ambient/opencode.json',
        OPENCODE_CONFIG_DIR: '/tmp/ambient',
        OPENCODE_ENABLE_EXA: 'true',
        TRACE_ID: 'preserved-trace',
      },
    }, boundaryFor(calls))

    // Then: the child reads plugins from the managed config directory without inheriting Exa
    expect(calls[0]?.options.env.OPENCODE_CONFIG).toBe('/tmp/managed/config/opencode.jsonc')
    expect(calls[0]?.options.env.OPENCODE_CONFIG_DIR).toBe('/tmp/managed/config')
    expect(calls[0]?.options.env.OPENCODE_ENABLE_EXA).toBeUndefined()
    expect(calls[0]?.options.env.TRACE_ID).toBe('preserved-trace')
  })
})
