import { describe, expect, test } from 'bun:test'
import { InstallAuth, InstallTarget } from '../src/cli/install-intent'
import { AutoRouterMode } from '../src/cli/auto-router'
import {
  CodexOnboardingMode,
  OnboardingFailureCode,
  OnboardingResourceAccess,
  runInstallOnboarding,
  type OnboardingIO,
  type OnboardingInput,
} from '../src/cli/onboarding'

type ScriptedIO = OnboardingIO & {
  readonly promptCount: () => number
  readonly writes: readonly string[]
}

function scriptedIO(inputs: readonly string[], isTTY = true): ScriptedIO {
  let index = 0
  const writes: string[] = []
  return {
    isTTY,
    prompt: async () => inputs[index++] ?? '',
    write: (message) => writes.push(message),
    promptCount: () => index,
    writes,
  }
}

function input(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    defaultTarget: InstallTarget.OpenCode,
    defaultGatewayOrigin: 'https://gateway.example.com/',
    defaultAuth: InstallAuth.Sso,
    defaultCodexMode: CodexOnboardingMode.Both,
    autoRouterMode: AutoRouterMode.Prompt,
    searchTools: [
      { name: 'agy-search', access: OnboardingResourceAccess.Available },
      { name: 'private-search', access: OnboardingResourceAccess.Unavailable },
      { name: 'exa-search', access: OnboardingResourceAccess.Available },
    ],
    mcpServers: [
      { name: 'github', access: OnboardingResourceAccess.Available },
      { name: 'filesystem', access: OnboardingResourceAccess.Available },
    ],
    mcpToolsets: [
      { name: 'research', access: OnboardingResourceAccess.Available },
      { name: 'admin', access: OnboardingResourceAccess.Unavailable },
    ],
    ...overrides,
  }
}

describe('install onboarding', () => {
  test('builds a confirmed both-target plan from numbered selections', async () => {
    // Given: an operator chooses both clients, environment auth, OAuth, and resource subsets
    const io = scriptedIO(['3', 'https://other.example.com/', '2', '2', '2', '', '0', '2', 'maybe', 'y'])

    // When: the interactive onboarding completes
    const result = await runInstallOnboarding(input(), io)

    // Then: the typed plan contains normalized, available selections only
    expect(result).toEqual({
      ok: true,
      plan: {
        target: InstallTarget.Both,
        gatewayOrigin: 'https://other.example.com',
        auth: InstallAuth.Environment,
        codexMode: CodexOnboardingMode.OAuth,
        autoRouter: AutoRouterMode.Configure,
        searchTools: ['exa-search'],
        mcpServers: ['github', 'filesystem'],
        mcpToolsets: [],
      },
    })
  })

  test('uses executable-derived and all-available defaults', async () => {
    // Given: Codex is the executable-derived target and every configurable answer is defaulted
    const io = scriptedIO(['', '', '', '', '', '', '', '', 'yes'])

    // When: onboarding accepts the defaults
    const result = await runInstallOnboarding(
      input({ defaultTarget: InstallTarget.Codex }),
      io,
    )

    // Then: the target is preserved and unavailable resources are excluded
    expect(result).toEqual({
      ok: true,
      plan: {
        target: InstallTarget.Codex,
        gatewayOrigin: 'https://gateway.example.com',
        auth: InstallAuth.Sso,
        codexMode: CodexOnboardingMode.Both,
        autoRouter: AutoRouterMode.Skip,
        searchTools: ['agy-search', 'exa-search'],
        mcpServers: ['github', 'filesystem'],
        mcpToolsets: ['research'],
      },
    })
  })

  test('reprompts invalid input and returns a typed cancellation', async () => {
    // Given: every prompt receives an invalid value before a valid value
    const io = scriptedIO([
      '9', '1',
      'not-a-url', '',
      'x', '',
      '1,1', '1',
      '1,0', '0',
      '2', '',
      '3', '',
      'later', 'n',
    ])

    // When: the operator declines the final confirmation
    const result = await runInstallOnboarding(input(), io)

    // Then: no plan is returned and each invalid value caused a reprompt
    expect(result).toEqual({
      ok: false,
      failure: {
        code: OnboardingFailureCode.Cancelled,
        message: 'Installation cancelled.',
      },
    })
    expect(io.promptCount()).toBe(16)
  })

  test('fails without reading input when no TTY is attached', async () => {
    // Given: the installer is running without a TTY
    const io = scriptedIO([], false)

    // When: interactive onboarding is requested
    const result = await runInstallOnboarding(input(), io)

    // Then: it fails with the non-interactive CLI route and does not prompt
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe(OnboardingFailureCode.TtyRequired)
    expect(result.failure.message).toContain('--non-interactive')
    expect(io.promptCount()).toBe(0)
  })

  test('skips empty catalogs and returns deterministic catalog order', async () => {
    // Given: only search has available resources and the operator selects them in reverse order
    const io = scriptedIO(['', '', '', '2,1', '', 'y'])

    // When: OpenCode onboarding completes
    const result = await runInstallOnboarding(
      input({ mcpServers: [], mcpToolsets: [] }),
      io,
    )

    // Then: skipped catalogs do not prompt and selections retain catalog order
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.searchTools).toEqual(['agy-search', 'exa-search'])
    expect(result.plan.mcpServers).toEqual([])
    expect(result.plan.mcpToolsets).toEqual([])
    expect(io.promptCount()).toBe(6)
  })

  test('loads available resources after the gateway and auth choices are known', async () => {
    const io = scriptedIO(['', 'https://selected.example.com', '2', '', '', 'y'])
    const connections: unknown[] = []

    const result = await runInstallOnboarding(input({
      loadResources: async (connection) => {
        connections.push(connection)
        return {
          searchTools: [{ name: 'live-search', access: OnboardingResourceAccess.Available }],
          mcpServers: [],
          mcpToolsets: [],
        }
      },
    }), io)

    expect(connections).toEqual([{
      target: InstallTarget.OpenCode,
      gatewayOrigin: 'https://selected.example.com',
      auth: InstallAuth.Environment,
    }])
    expect(result).toMatchObject({
      ok: true,
      plan: { searchTools: ['live-search'] },
    })
  })
})
