import { describe, expect, test } from 'bun:test'
import { launchAgent } from '../src/cli/agent-launch'
import { CodexMode } from '../src/cli/install-intent'
import { boundaryFor, type CapturedAgentCall } from './agent-launch-test-support'

describe('direct LiteLLM agent launcher', () => {
  test('preserves the main Codex config in Both mode without injecting a profile', () => {
    // Given: a Codex Both-mode launch with no explicit profile
    const calls: CapturedAgentCall[] = []

    // When: Codex is launched in Both mode
    launchAgent({
      command: 'codex',
      args: ['resume', '--last'],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-gateway-key',
      codexMode: CodexMode.Both,
      environment: {
        CODEX_API_KEY: 'ambient-codex-key',
        OPENAI_API_KEY: 'ambient-openai-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        ANTHROPIC_API_KEY: 'ambient-anthropic-key',
        LITELLM_API_KEY: 'ambient-litellm-key',
        LITELLM_MASTER_KEY: 'ambient-master-key',
        OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key',
      },
    }, boundaryFor(calls))

    // Then: the main gateway config is used and only the selected key is added
    expect(calls[0]?.args).toEqual(['resume', '--last'])
    expect(calls[0]?.options.env.LITELLM_PROXY_API_KEY).toBe('child-gateway-key')
    expect(calls[0]?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(calls[0]?.options.env.CODEX_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENAI_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENAI_BASE_URL).toBeUndefined()
    expect(calls[0]?.options.env.ANTHROPIC_API_KEY).toBe('ambient-anthropic-key')
    expect(calls[0]?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENCODE_LITELLM_API_KEY).toBeUndefined()
    expect(JSON.stringify(calls[0]?.args)).not.toContain('child-gateway-key')
  })

  test('does not inject a profile when OAuth is the main Codex config', () => {
    const calls: CapturedAgentCall[] = []

    launchAgent({
      command: 'codex',
      args: ['resume'],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-gateway-key',
      codexMode: CodexMode.OAuth,
      authEnv: 'CUSTOM_CODEX_KEY',
      environment: { CUSTOM_CODEX_KEY: 'ambient-key' },
    }, boundaryFor(calls))

    expect(calls[0]?.args).toEqual(['resume'])
    expect(calls[0]?.options.env.CUSTOM_CODEX_KEY).toBe('child-gateway-key')
  })

  test('preserves explicit long and short Codex profiles and forwards status and signal', () => {
    // Given: a caller-selected Codex profile and a child terminated by SIGINT
    const calls: CapturedAgentCall[] = []

    // When: the OAuth-mode launch is handed to the process boundary
    const result = launchAgent({
      command: 'codex',
      args: ['-pfoo', 'resume'],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-gateway-key',
      codexMode: CodexMode.OAuth,
      environment: {},
    }, boundaryFor(calls, { status: null, signal: 'SIGINT' }))

    // Then: user args and the child termination result are preserved
    expect(calls[0]?.args).toEqual(['-pfoo', 'resume'])
    expect(result).toEqual({ status: null, signal: 'SIGINT' })
  })
})
