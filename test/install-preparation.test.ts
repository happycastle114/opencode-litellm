import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INSTALL_SELECTION_RESOURCE, INSTALL_SELECTION_WARNING_KIND,
  InstallPreparationError, InstallPreparationErrorCode, prepareInstall,
  type InstallPreparationBoundary } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget,
  type InstallOptions } from '../src/cli/install-intent'
import type { GatewayToolDiscoveryResult } from '../src/cli/gateway-tool-discovery'

const VALUE = {
  defaultOrigin: 'https://default.example.test',
  changedOrigin: 'https://changed.example.test',
  otherOrigin: 'https://other.example.test',
  apiKey: 'sk-preparation-secret',
  envName: 'TEST_LITELLM_KEY',
} as const

const DISCOVERY: GatewayToolDiscoveryResult = {
  models: [{ id: 'coding-fast' }],
  searchToolNames: ['search-visible', 'search-second'],
  mcpServerNames: ['mcp-visible', 'mcp-second'],
  toolsets: [
    { toolsetId: 'ts-visible', toolsetName: 'toolset-visible' },
    { toolsetId: 'ts-second', toolsetName: 'toolset-second' },
  ],
  warnings: [],
}

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation', () => {
  test('auto-selects every authorized gateway resource for empty non-interactive flags', async () => {
    // Given: environment authentication and no explicit resource filters
    const options = installOptions({ auth: InstallAuth.Environment, nonInteractive: true })
    const calls: Array<{ readonly origin: string; readonly apiKey: string }> = []

    // When: the canonical preparation boundary runs
    const prepared = await prepareInstall(options, boundary({
      env: { HOME: homeDirectory, [VALUE.envName]: VALUE.apiKey },
      discover: async (input) => {
        calls.push({ origin: input.origin, apiKey: input.apiKey })
        return DISCOVERY
      },
    }))

    // Then: discovery is authenticated and every visible resource is selected
    expect(calls).toEqual([{ origin: VALUE.defaultOrigin, apiKey: VALUE.apiKey }])
    expect(prepared.options).toMatchObject({
      baseUrl: VALUE.defaultOrigin,
      search: DISCOVERY.searchToolNames,
      mcp: DISCOVERY.mcpServerNames,
      toolsets: ['toolset-visible', 'toolset-second'],
    })
    expect(prepared.discovery).toBe(DISCOVERY)
    expect(prepared.apiKey).toBe(VALUE.apiKey)
    expect(prepared.selectionWarnings).toEqual([])
  })

  test('keeps explicit filters visible, warns for hidden names, and honors opt-outs', async () => {
    // Given: explicit filters contain visible and unauthorized names
    const options = installOptions({
      auth: InstallAuth.Environment,
      nonInteractive: true,
      search: ['search-hidden', 'search-visible'],
      mcp: ['mcp-hidden', 'mcp-visible'],
      toolsets: ['toolset-hidden', 'toolset-visible'],
      disableMcp: ['disabled-hidden', 'mcp-second'],
      noToolsets: true,
    })

    // When: selections are prepared against the authenticated discovery result
    const prepared = await prepareInstall(options, boundary({
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => DISCOVERY,
    }))

    // Then: only visible items survive and the opted-out category stays empty
    expect(prepared.options).toMatchObject({
      search: ['search-visible'],
      mcp: ['mcp-visible'],
      toolsets: [],
      disableMcp: ['mcp-second'],
    })
    expect(prepared.selectionWarnings).toEqual([
      warning(INSTALL_SELECTION_RESOURCE.Search, 'search-hidden'),
      warning(INSTALL_SELECTION_RESOURCE.Mcp, 'mcp-hidden'),
      warning(INSTALL_SELECTION_RESOURCE.DisabledMcp, 'disabled-hidden'),
    ])
  })

  test('fails with a typed secret-safe error when an environment credential is missing', async () => {
    // Given: the named environment variable is absent
    const pending = prepareInstall(
      installOptions({ auth: InstallAuth.Environment, nonInteractive: true }),
      boundary({ env: { UNRELATED_SECRET: VALUE.apiKey } }),
    )

    // When/Then: preparation fails before discovery without exposing any value
    await expect(pending).rejects.toBeInstanceOf(InstallPreparationError)
    await expect(pending).rejects.toMatchObject({
      code: InstallPreparationErrorCode.MissingEnvironmentCredential,
    })
    await expect(pending).rejects.not.toThrow(VALUE.apiKey)
  })

  test('rejects a non-interactive SSO token for another exact origin actionably', async () => {
    // Given: the official token belongs to a different gateway
    writeToken(VALUE.otherOrigin)
    const pending = prepareInstall(
      installOptions({ auth: InstallAuth.Sso, nonInteractive: true }),
      boundary(),
    )

    // When/Then: the error identifies the remediation but never the stored key
    await expect(pending).rejects.toMatchObject({
      code: InstallPreparationErrorCode.MissingSsoCredential,
    })
    await expect(pending).rejects.toThrow(/login/i)
    await expect(pending).rejects.not.toThrow(VALUE.apiKey)
  })

  test('uses changed interactive choices before SSO and authenticated discovery', async () => {
    // Given: staged answers change the gateway before accepting all resources
    const answers = ['', `${VALUE.changedOrigin}/`, '', '', '', '', '', 'y']
    const writes: string[] = []
    let promptCount = 0
    let onboardedAt = -1
    let discoveredAt = -1
    const prepared = await prepareInstall(
      installOptions({ target: InstallTarget.Both, auth: InstallAuth.Sso }),
      boundary({
        onboardingIO: {
          isTTY: true,
          prompt: async () => {
            promptCount += 1
            return answers.shift() ?? ''
          },
          write: (message) => writes.push(message),
        },
        onboard: async (input) => {
          onboardedAt = promptCount
          expect(input.baseUrl).toBe(VALUE.changedOrigin)
          expect(input.tokenFilePath).toBe(join(homeDirectory, '.litellm', 'token.json'))
          writeToken(VALUE.changedOrigin)
          return { status: 'authenticated' }
        },
        discover: async (input) => {
          discoveredAt = promptCount
          expect(input).toMatchObject({ origin: VALUE.changedOrigin, apiKey: VALUE.apiKey })
          return DISCOVERY
        },
      }),
    )

    // When/Then: auth/discovery run after connection choices and before resource prompts
    expect(onboardedAt).toBe(4)
    expect(discoveredAt).toBe(4)
    expect(prepared.options).toMatchObject({
      target: InstallTarget.Both,
      baseUrl: VALUE.changedOrigin,
      auth: InstallAuth.Sso,
      codexMode: CodexMode.Both,
      search: DISCOVERY.searchToolNames,
      mcp: DISCOVERY.mcpServerNames,
      toolsets: ['toolset-visible', 'toolset-second'],
    })
    expect(writes.join('\n')).not.toContain(VALUE.apiKey)
  })
})

function installOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    target: InstallTarget.OpenCode,
    baseUrl: VALUE.defaultOrigin,
    auth: InstallAuth.Sso,
    authEnv: VALUE.envName,
    nonInteractive: false,
    opencodeConfig: undefined,
    codexConfig: undefined,
    codexMode: CodexMode.Both,
    search: [],
    mcp: [],
    toolsets: [],
    disableMcp: [],
    noSearch: false,
    noMcp: false,
    noToolsets: false,
    ...overrides,
  }
}

function boundary(
  overrides: Partial<InstallPreparationBoundary> = {},
): InstallPreparationBoundary {
  return {
    env: {},
    home: () => homeDirectory,
    now: () => 123_000,
    ssoBoundaries: { open: async () => undefined, selectTeam: async () => undefined },
    ...overrides,
  }
}

function writeToken(origin: string): void {
  const directory = join(homeDirectory, '.litellm')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'token.json'), JSON.stringify({
    base_url: origin,
    key: VALUE.apiKey,
  }))
}

function warning(resource: string, name: string) {
  return { kind: INSTALL_SELECTION_WARNING_KIND.NotVisible, resource, name }
}
