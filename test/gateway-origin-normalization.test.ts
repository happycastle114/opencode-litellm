import { describe, expect, test } from 'bun:test'
import {
  AgentCommand,
  launchAgent,
  type AgentLaunchBoundary,
  type AgentSpawnOptions,
} from '../src/cli/agent-launch'
import { resolveClaudeMarketplaceUrl } from '../src/cli/claude-marketplace-asset'
import { normalizeOrigin } from '../src/cli/install-intent'

const GATEWAY_INPUT = 'https://gateway.example.test/proxy/v1///' as const
const GATEWAY_ORIGIN = 'https://gateway.example.test/proxy' as const

describe('gateway origin canonicalization', () => {
  test.each([
    ['https://gateway.example.test/proxy/v1///', GATEWAY_ORIGIN],
    ['https://gateway.example.test/v1///', 'https://gateway.example.test'],
    ['https://gateway.example.test/v1/proxy///', 'https://gateway.example.test/v1/proxy'],
    ['https://gateway.example.test/proxy/v1/v1///', 'https://gateway.example.test/proxy/v1'],
    ['https://gateway.example.test/proxy/v1-other///', 'https://gateway.example.test/proxy/v1-other'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected)
  })

  test('is idempotent after terminal /v1 removal', () => {
    const once = normalizeOrigin(GATEWAY_INPUT)
    expect(once).toBe(GATEWAY_ORIGIN)
    expect(normalizeOrigin(once ?? '')).toBe(once)
  })

  test.each([
    'https://user:secret@gateway.example.test/proxy/v1',
    'https://gateway.example.test/proxy/v1?key=secret',
    'https://gateway.example.test/proxy/v1#secret',
    'ftp://gateway.example.test/proxy/v1',
  ])('rejects unsafe or non-http gateway input %s', (input) => {
    expect(normalizeOrigin(input)).toBeUndefined()
  })

  test('direct Claude launch appends /claude-max to the canonical proxy root', () => {
    const call = captureLaunch(AgentCommand.Claude, {
      apiKey: 'gateway-key',
    })

    expect(call.ANTHROPIC_BASE_URL).toBe(`${GATEWAY_ORIGIN}/claude-max`)
  })

  test('direct OpenCode launch receives the canonical proxy root', () => {
    const call = captureLaunch(AgentCommand.OpenCode, {
      apiKey: 'gateway-key',
    })

    expect(call.LITELLM_PROXY_URL).toBe(GATEWAY_ORIGIN)
  })

  test('direct Codex launch keeps the canonical gateway key boundary', () => {
    const call = captureLaunch(AgentCommand.Codex, {
      apiKey: 'gateway-key',
    })

    expect(call.LITELLM_PROXY_API_KEY).toBe('gateway-key')
    expect(call.CODEX_API_KEY).toBeUndefined()
  })

  test('Claude marketplace URL uses the canonical proxy root', () => {
    expect(resolveClaudeMarketplaceUrl(GATEWAY_INPUT)).toBe(
      `${GATEWAY_ORIGIN}/claude-code/marketplace.json`,
    )
  })
})

function captureLaunch(
  command: AgentCommand,
  input: { readonly apiKey: string },
): Readonly<Record<string, string | undefined>> {
  let environment: Readonly<Record<string, string | undefined>> | undefined
  const boundary: AgentLaunchBoundary = {
    which: (value) => value,
    spawn: (_file, _args, options: AgentSpawnOptions) => {
      environment = options.env
      return { status: 0, signal: null }
    },
  }
  launchAgent({
    command,
    args: [],
    gatewayOrigin: GATEWAY_INPUT,
    apiKey: input.apiKey,
    environment: {},
  }, boundary)
  if (environment === undefined) throw new Error('launch did not reach the spawn boundary')
  return environment
}
