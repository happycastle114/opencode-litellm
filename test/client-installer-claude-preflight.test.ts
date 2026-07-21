import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import { resolveOhMyOpenAgentProfilePath } from '../src/cli/qwen-routing'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  ApiKey: 'claude-preflight-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'claude-preflight-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('Claude marketplace transaction preflight', () => {
  test('leaves every client asset unchanged when Claude settings are malformed', async () => {
    // Given: existing OpenCode, Codex, launch, helper, catalog, and skill assets
    const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const codexPath = join(homeDirectory, '.codex', 'config.toml')
    const launchPath = resolveLaunchConfigPath({ HOME: homeDirectory })
    const files = new Map<string, string>([
      [openCodePath, '{\n  "keep": "opencode"\n}\n'],
      [resolveOhMyOpenAgentProfilePath(openCodePath), '{\n  "keep": "profile"\n}\n'],
      [codexPath, 'approval_policy = "never"\n'],
      [join(homeDirectory, '.codex', 'litellm-models.json'), '{"keep":"gateway"}\n'],
      [join(homeDirectory, '.codex', 'litellm-codex-oauth-models.json'), '{"keep":"oauth"}\n'],
      [join(homeDirectory, '.codex', 'codex-oauth.config.toml'), 'keep = "oauth"\n'],
      [join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs'), 'keep helper\n'],
      [join(homeDirectory, '.agents', 'skills', 'litellm-research-router', 'SKILL.md'), 'keep skill\n'],
      [launchPath, `${JSON.stringify({
        schemaVersion: 1,
        claude: {
          gatewayOrigin: 'https://old.example.test',
          auth: 'env',
          authEnv: 'OLD_KEY',
        },
      })}\n`],
      [join(homeDirectory, '.claude', 'settings.json'), '{ malformed\n'],
    ])
    for (const [path, contents] of files) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, contents)
    }
    const before = snapshotTree(homeDirectory)
    let pluginCalls = 0
    let catalogCalls = 0

    // When: the public combined installer plans the malformed Claude asset
    const result = await runCliProgram([
      'install', '--target', 'both', '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env', '--auth-env', VALUE.AuthEnvironment,
      '--codex-mode', 'both', '--opencode-config', openCodePath,
      '--codex-config', codexPath, '--non-interactive',
      '--no-search', '--no-mcp', '--no-toolsets',
    ], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      externalSetup: true,
      gatewayDiscovery: async () => ({
        models: [], searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [],
      }),
      bundledCodexCatalog: () => {
        catalogCalls += 1
        throw new Error('catalog planning must not run')
      },
      managedPluginBoundary: {
        fs: { exists: () => false, isFile: () => true },
        command: {
          run: async () => {
            pluginCalls += 1
            return { exitCode: 1, stdout: '', stderr: 'must not run' }
          },
        },
      },
    })

    // Then: parsing fails before catalog/plugin activation or any filesystem mutation
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Claude settings must contain valid JSON')
    expect(catalogCalls).toBe(0)
    expect(pluginCalls).toBe(0)
    expect(snapshotTree(homeDirectory)).toEqual(before)
  })
})

function snapshotTree(root: string): readonly string[] {
  const entries: string[] = []
  visit(root, '', entries)
  return entries.sort()
}

function visit(root: string, relative: string, entries: string[]): void {
  const path = relative === '' ? root : join(root, relative)
  for (const name of readdirSync(path)) {
    const childRelative = relative === '' ? name : join(relative, name)
    const child = join(root, childRelative)
    const status = statSync(child)
    if (status.isDirectory()) {
      entries.push(`directory:${childRelative}:${status.mode & 0o777}`)
      visit(root, childRelative, entries)
    } else {
      entries.push(
        `file:${childRelative}:${status.mode & 0o777}:${readFileSync(child).toString('base64')}`,
      )
    }
  }
}
