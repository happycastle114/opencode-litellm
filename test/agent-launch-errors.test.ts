import { describe, expect, test } from 'bun:test'
import { launchAgent } from '../src/cli/agent-launch'
import { boundaryFor, type CapturedAgentCall } from './agent-launch-test-support'

describe('direct LiteLLM agent launcher', () => {
  test('rejects unsupported commands before spawning', () => {
    // Given: a command outside the owned launcher set
    const calls: CapturedAgentCall[] = []

    // When / Then: validation fails deterministically and the child boundary is untouched
    expect(() => launchAgent({
      command: 'login',
      args: [],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'secret',
      environment: {},
    }, boundaryFor(calls))).toThrow(/unsupported.*command/i)
    expect(calls).toHaveLength(0)
  })

  test('reports a deterministic executable-not-found error', () => {
    // Given: a validated command whose executable cannot be resolved
    let spawnCalled = false

    // When / Then: lookup fails without printing or persisting the key
    expect(() => launchAgent({
      command: 'claude',
      args: [],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'secret-key',
      environment: {},
    }, {
      which: () => undefined,
      spawn: () => {
        spawnCalled = true
        return { status: 0, signal: null }
      },
    })).toThrow(/claude.*not found.*path/i)
    expect(spawnCalled).toBe(false)
  })
})
