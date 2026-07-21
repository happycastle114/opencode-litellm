import { describe, expect, test } from 'bun:test'
import { launchAgent } from '../src/cli/agent-launch'
import { boundaryFor, type CapturedAgentCall } from './agent-launch-test-support'

describe('direct LiteLLM agent launcher', () => {
  test('routes Claude Code through /claude-max without replacing Anthropic OAuth', () => {
    // Given: a Claude environment with conflicting API credentials and a gateway key
    const calls: CapturedAgentCall[] = []
    const environment = {
      HOME: '/tmp/home',
      ANTHROPIC_API_KEY: 'ambient-api-key',
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Trace: one',
      LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
      LITELLM_API_KEY: 'ambient-litellm-key',
      LITELLM_MASTER_KEY: 'ambient-master-key',
      OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key',
      OPENAI_API_KEY: 'ambient-openai-key',
    } as const

    // When: Claude is launched with a gateway admission key
    launchAgent({
      command: 'claude',
      args: ['--model', 'claude-sonnet'],
      gatewayOrigin: 'https://llm.example.com/',
      apiKey: 'child-gateway-key',
      environment,
    }, boundaryFor(calls))

    // Then: only the child receives the routed endpoint and separate admission header
    const call = calls[0]
    expect(call?.file).toBe('claude')
    expect(call?.args).toEqual(['--model', 'claude-sonnet'])
    expect(call?.options.stdio).toBe('inherit')
    // The pinned generic pass-through auth dependency normalizes this Bearer scheme
    // before validating the LiteLLM key; Authorization remains Claude OAuth-owned.
    expect(call?.options.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://llm.example.com/claude-max',
      ANTHROPIC_CUSTOM_HEADERS: 'x-litellm-api-key: Bearer child-gateway-key',
    })
    expect(call?.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(call?.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(call?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(call?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(call?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(call?.options.env.OPENCODE_LITELLM_API_KEY).toBeUndefined()
    expect(call?.options.env.OPENAI_API_KEY).toBe('ambient-openai-key')
    expect(environment.ANTHROPIC_API_KEY).toBe('ambient-api-key')
    expect(JSON.stringify(call?.options)).not.toContain('ambient-api-key')
  })
})
