import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { installPreparedClients } from '../src/cli/client-installer'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import type { PreparedInstall } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import { resolveOhMyOpenAgentProfilePath } from '../src/cli/qwen-routing'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  ApiKey: 'installer-preflight-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const
const PLATFORM = { Darwin: 'darwin' } as const
const BUNDLED_CATALOG = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-installer-preflight-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('client installer preflight', () => {
  test('leaves OpenCode unchanged when the OpenAgent profile is malformed', async () => {
    // Given: an existing OpenCode config and a malformed managed OpenAgent profile
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(configPath)
    const configSource = '{\n  "keep": "opencode"\n}\n'
    const profileSource = '{ malformed\n'
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, configSource)
    writeFileSync(profilePath, profileSource)

    // When: the single-client installation preflights its managed assets
    const installation = installPreparedClients(preparedInstall({
      target: InstallTarget.OpenCode,
      opencodeConfig: configPath,
    }), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    // Then: the parse failure occurs before either config or the shared skill changes
    await expect(installation).rejects.toThrow()
    expect(readFileSync(configPath, 'utf8')).toBe(configSource)
    expect(readFileSync(profilePath, 'utf8')).toBe(profileSource)
    expect(readdirSync(dirname(configPath)).sort()).toEqual([
      'oh-my-openagent.json',
      'opencode.jsonc',
    ])
    expect(existsSync(researchSkillPath())).toBe(false)
  })

  test('leaves both clients unchanged when the bundled Codex catalog fails', async () => {
    // Given: existing OpenCode and Codex assets selected through the public --target both surface
    let managedPluginCommands = 0
    const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const openAgentPath = resolveOhMyOpenAgentProfilePath(openCodePath)
    const codexPath = join(homeDirectory, '.codex', 'config.toml')
    const existingFiles = new Map<string, string>([
      [openCodePath, '{\n  "keep": "opencode"\n}\n'],
      [openAgentPath, '{\n  "keep": "openagent"\n}\n'],
      [codexPath, 'approval_policy = "never"\n'],
      [join(homeDirectory, '.codex', 'litellm-models.json'), '{"keep":"gateway"}\n'],
      [join(homeDirectory, '.codex', 'litellm-codex-oauth-models.json'), '{"keep":"oauth"}\n'],
      [join(homeDirectory, '.codex', 'codex-oauth.config.toml'), 'keep = "oauth-profile"\n'],
      [join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs'), 'keep helper\n'],
      [researchSkillPath(), 'keep skill\n'],
    ])
    for (const [path, contents] of existingFiles) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, contents)
    }

    // When: bundled catalog loading fails after gateway discovery succeeds
    const result = await runCliProgram([
      'install',
      '--target',
      'both',
      '--base-url',
      VALUE.GatewayOrigin,
      '--auth',
      'env',
      '--auth-env',
      VALUE.AuthEnvironment,
      '--codex-mode',
      'both',
      '--opencode-config',
      openCodePath,
      '--codex-config',
      codexPath,
      '--non-interactive',
    ], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      externalSetup: true,
      gatewayDiscovery: async () => preparedInstall({}).discovery,
      bundledCodexCatalog: () => {
        throw new Error('bundled catalog preflight failed')
      },
      managedPluginBoundary: {
        fs: { exists: () => true, isFile: () => true },
        command: {
          run: async () => {
            managedPluginCommands += 1
            throw new Error('managed plugin checkout ran before Codex preflight')
          },
        },
      },
    })

    // Then: no selected client asset, backup, shared skill, helper, or launch state changes
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('bundled catalog preflight failed')
    for (const [path, contents] of existingFiles) {
      expect(readFileSync(path, 'utf8')).toBe(contents)
    }
    expect(readdirSync(dirname(openCodePath)).some((name) => name.includes('.bak'))).toBe(false)
    expect(readdirSync(dirname(codexPath)).some((name) => name.includes('.bak'))).toBe(false)
    expect(existsSync(join(homeDirectory, '.config', 'opencode-litellm', 'launch.json'))).toBe(false)
    expect(managedPluginCommands).toBe(0)
  })

  test.each([
    ['MCP', { mcp: ['mcp-visible'] }],
    ['toolset', { toolsets: ['toolset-visible'] }],
  ] as const)(
    'syncs the SSO environment when gateway mode renders %s bearer auth',
    async (_resource, resourceOptions) => {
      // Given: a native macOS Codex gateway install with a bearer-token reference
      const calls: Array<{ readonly file: string; readonly args: readonly string[] }> = []
      const configPath = join(homeDirectory, '.codex', 'config.toml')

      // When: the gateway-only plan is applied through the external setup boundary
      await installPreparedClients(preparedInstall({
        target: InstallTarget.Codex,
        auth: InstallAuth.Sso,
        codexConfig: configPath,
        codexMode: CodexMode.Gateway,
        noMcp: false,
        ...resourceOptions,
      }), {
        env: { HOME: homeDirectory },
        now: () => new Date(0),
        externalSetup: true,
        platform: PLATFORM.Darwin,
        bundledCodexCatalog: () => BUNDLED_CATALOG,
        codexSpawnBoundary: {
          spawn: (file, args) => {
            calls.push({ file, args })
            return { status: 0, signal: null, stdout: '', stderr: '' }
          },
        },
      })

      // Then: launchd receives the exact helper and bearer environment name
      expect(calls).toEqual([{
        file: process.execPath,
        args: [
          join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs'),
          '--launchctl-setenv',
          VALUE.AuthEnvironment,
        ],
      }])
    },
  )
})

function preparedInstall(
  overrides: Partial<PreparedInstall['options']>,
): PreparedInstall {
  return {
    options: {
      target: InstallTarget.Codex,
      baseUrl: VALUE.GatewayOrigin,
      auth: InstallAuth.Environment,
      authEnv: VALUE.AuthEnvironment,
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: CodexMode.Both,
      search: [],
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: true,
      noMcp: false,
      noToolsets: false,
      ...overrides,
    },
    apiKey: VALUE.ApiKey,
    discovery: {
      models: [{ id: 'gateway-model' }],
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [],
    },
    selectionWarnings: [],
  }
}

function researchSkillPath(): string {
  return join(
    homeDirectory,
    '.agents',
    'skills',
    'litellm-research-router',
    'SKILL.md',
  )
}
