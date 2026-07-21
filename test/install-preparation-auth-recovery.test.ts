import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexDiscoveryError } from '../src/cli/codex-discovery'
import type { GatewayToolDiscoveryResult } from '../src/cli/gateway-tool-discovery'
import { InstallPreparationErrorCode, prepareInstall,
  type InstallPreparationBoundary } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault,
  type InstallOptions } from '../src/cli/install-intent'
import { loadOfficialLiteLLMApiKey } from '../src/cli/official-token'

const VALUE = {
  origin: 'https://stale-token.example.test',
  staleApiKey: 'sk-stale-preparation-secret',
  refreshedApiKey: 'sk-refreshed-preparation-secret',
  envName: 'TEST_LITELLM_KEY',
} as const

const DISCOVERY: GatewayToolDiscoveryResult = {
  models: [{ id: 'coding-fast' }],
  searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [],
}

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-auth-recovery-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation authentication recovery', () => {
  test.each([
    [InstallAuth.Sso, InstallPreparationErrorCode.SsoReauthenticationRequired, true],
    [InstallAuth.Environment, InstallPreparationErrorCode.DiscoveryFailed, false],
  ] as const)('does not silently renew non-interactive %s auth', async (auth, code, hasToken) => {
    // Given: authenticated discovery rejects the current credential
    if (hasToken) writeToken(VALUE.staleApiKey)
    let onboardCount = 0

    // When: non-interactive preparation receives an authentication failure
    const pending = prepareInstall(options({ auth, nonInteractive: true }), boundary({
      env: { [VALUE.envName]: VALUE.staleApiKey },
      onboard: async () => { onboardCount += 1; return { status: 'authenticated' } },
      discover: async () => { throw new CodexDiscoveryError('Authentication failed.', 401) },
    }))

    // Then: SSO is never launched and the failure remains typed and actionable
    await expect(pending).rejects.toMatchObject({ code })
    expect(onboardCount).toBe(0)
  })

  test.each([401, 403] as const)(
    'refreshes a stale interactive SSO token once after HTTP %i discovery',
    async (status) => {
      // Given: an exact-origin token is rejected by authenticated discovery
      writeToken(VALUE.staleApiKey)
      const answers = ['', '', '', '', 'y']
      const discoveryKeys: string[] = []
      let onboardCount = 0

      // When: interactive preparation reaches the resource-loading stage
      const prepared = await prepareInstall(options(), boundary({
        onboardingIO: {
          isTTY: true,
          prompt: async () => answers.shift() ?? '',
          write: () => undefined,
        },
        onboard: async (input) => {
          onboardCount += 1
          expect(loadOfficialLiteLLMApiKey({
            tokenFilePath: input.tokenFilePath,
            expectedBaseURL: input.baseUrl,
          })).toBe(VALUE.staleApiKey)
          writeToken(VALUE.refreshedApiKey)
          return { status: 'authenticated' }
        },
        discover: async (input) => {
          discoveryKeys.push(input.apiKey)
          if (discoveryKeys.length === 1) {
            throw new CodexDiscoveryError('Authentication failed.', status)
          }
          return DISCOVERY
        },
      }))

      // Then: the old file survives until SSO replaces it and discovery retries once
      expect(onboardCount).toBe(1)
      expect(discoveryKeys).toEqual([VALUE.staleApiKey, VALUE.refreshedApiKey])
      expect(prepared.apiKey).toBe(VALUE.refreshedApiKey)
    },
  )
})

function options(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    target: InstallTarget.OpenCode, baseUrl: VALUE.origin, auth: InstallAuth.Sso,
    authEnv: VALUE.envName, nonInteractive: false,
    opencodeConfig: undefined, codexConfig: undefined, codexMode: CodexMode.Both,
    autoRouter: ToolkitDefault.InteractiveAutoRouter,
    search: [], mcp: [], toolsets: [], enableMcp: [], disableMcp: [],
    noSearch: false, noMcp: false, noToolsets: false,
    ...overrides,
  }
}

function boundary(
  overrides: Partial<InstallPreparationBoundary> = {},
): InstallPreparationBoundary {
  return {
    env: {}, home: () => homeDirectory, now: () => 123_000,
    ssoBoundaries: { open: async () => undefined, selectTeam: async () => undefined },
    ...overrides,
  }
}

function writeToken(key: string): void {
  const directory = join(homeDirectory, '.litellm')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'token.json'), JSON.stringify({
    base_url: VALUE.origin,
    key,
  }))
}
