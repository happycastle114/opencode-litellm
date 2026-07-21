import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
  Token: 'post-commit-token',
} as const
const MANAGED_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: '83ea2674a8afb578a670188fb3b522fc242a77cb',
} as const
const BUNDLED_CATALOG_SOURCE = readFileSync(
  new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
  'utf8',
)
const BUNDLED_CATALOG = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    signal: null,
    stdout: BUNDLED_CATALOG_SOURCE,
    stderr: '',
  }),
})

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-post-commit-'))
  const tokenPath = join(homeDirectory, '.litellm', 'token.json')
  mkdirSync(dirname(tokenPath), { recursive: true })
  writeFileSync(tokenPath, `${JSON.stringify({
    base_url: VALUE.GatewayOrigin,
    key: VALUE.Token,
  })}\n`)
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('Codex post-commit environment sync', () => {
  test('does not invoke launchd when the filesystem commit fails', async () => {
    // Given: an SSO Codex install whose first filesystem promotion will fail
    let launchdCalls = 0

    // When: the transaction aborts before every destination is committed
    const result = await runCliProgram(installArguments(), {
      ...programBoundary(),
      codexSpawnBoundary: {
        spawn: () => {
          launchdCalls += 1
          return { status: 0, signal: null, stdout: '', stderr: '' }
        },
      },
      clientInstallCommitBoundary: {
        moveExclusive: () => {
          throw new Error('injected filesystem promotion failure')
        },
      },
    })

    // Then: launchd was never touched and no transactional destination remains
    expect(result.exitCode).toBe(1)
    expect(launchdCalls).toBe(0)
    for (const path of committedPaths()) expect(existsSync(path)).toBe(false)
  })

  test('keeps committed files and reports a warning when launchd throws', async () => {
    // Given: a fully stageable SSO Codex install with a throwing launchd boundary
    let launchdCalls = 0

    // When: launchd export fails after the filesystem transaction commits
    const result = await runCliProgram(installArguments(), {
      ...programBoundary(),
      codexSpawnBoundary: {
        spawn: () => {
          launchdCalls += 1
          throw new Error('injected launchd failure')
        },
      },
    })

    // Then: installation succeeds, warns, and every filesystem destination remains
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Warning: Could not export ${VALUE.AuthEnvironment}`)
    expect(launchdCalls).toBe(1)
    for (const path of committedPaths()) expect(existsSync(path)).toBe(true)
  })

  test('does not roll back managed activation after cleanup warns', async () => {
    // Given: an existing OpenCode config and a new managed plugin revision
    const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const original = '{\n  "keep": "opencode"\n}\n'
    mkdirSync(dirname(openCodePath), { recursive: true })
    writeFileSync(openCodePath, original)
    const checkoutPath = join(
      dirname(openCodePath),
      'vendor',
      'opencode-litellm-git',
      MANAGED_PLUGIN.revision,
    )
    const managed = createManagedBoundary(checkoutPath)
    const secret = 'post-commit-cleanup-secret'

    // When: the transaction commits but injected staging cleanup reports a fault
    const result = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env', '--auth-env', VALUE.AuthEnvironment,
      '--opencode-config', openCodePath, '--non-interactive',
      '--no-search', '--no-mcp', '--no-toolsets',
    ], {
      ...programBoundary(),
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: 'post-commit-key' },
      managedPluginBoundary: managed.boundary,
      clientInstallCommitBoundary: {
        moveExclusive,
        cleanupTransaction: () => {
          throw new Error(`injected staging cleanup failure: ${secret}`)
        },
      },
    })

    // Then: the destination and plugin stay published, with a fixed warning only
    expect(result.exitCode).toBe(0)
    expect(readFileSync(openCodePath, 'utf8')).not.toBe(original)
    expect(result.stdout).toContain('temporary staging cleanup failed')
    expect(result.stdout).not.toContain(secret)
    expect(managed.existingPaths.has(checkoutPath)).toBe(true)
    expect(managed.removedPaths).toEqual([])
  })
})

function installArguments(): readonly string[] {
  return [
    'install', '--target', 'codex', '--base-url', VALUE.GatewayOrigin,
    '--auth', 'sso', '--auth-env', VALUE.AuthEnvironment,
    '--codex-mode', 'oauth', '--non-interactive',
    '--no-search', '--no-mcp', '--no-toolsets',
  ]
}

function programBoundary() {
  return {
    env: { HOME: homeDirectory },
    now: () => new Date(0),
    externalSetup: true,
    platform: 'darwin',
    bundledCodexCatalog: () => BUNDLED_CATALOG,
    gatewayDiscovery: async () => ({
      models: [], searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [],
    }),
  }
}

function committedPaths(): readonly string[] {
  return [
    join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs'),
    join(homeDirectory, '.codex', 'litellm-codex-oauth-models.json'),
    join(homeDirectory, '.codex', 'config.toml'),
    join(homeDirectory, '.agents', 'skills', 'litellm-research-router', 'SKILL.md'),
    join(homeDirectory, '.claude', 'settings.json'),
    resolveLaunchConfigPath({ HOME: homeDirectory }),
  ]
}

function createManagedBoundary(checkoutPath: string) {
  const existingPaths = new Set<string>()
  const removedPaths: string[] = []
  return {
    existingPaths,
    removedPaths,
    boundary: {
      fs: {
        exists: (path: string) => existingPaths.has(path),
        isFile: () => true,
        rename: (source: string, destination: string) => {
          existingPaths.delete(source)
          existingPaths.add(destination)
        },
        remove: (path: string) => {
          existingPaths.delete(path)
          removedPaths.push(path)
        },
      },
      command: {
        run: async (invocation: { readonly executable: string; readonly args: readonly string[] }) => {
          if (invocation.executable === 'npm') return success('')
          if (invocation.args[0] === 'clone') {
            const stagingPath = invocation.args.at(-1)
            if (stagingPath !== undefined) existingPaths.add(stagingPath)
            return success('')
          }
          if (invocation.args.includes('get-url')) return success(`${MANAGED_PLUGIN.repository}\n`)
          if (invocation.args.includes('rev-parse')) return success(`${MANAGED_PLUGIN.revision}\n`)
          return success('')
        },
      },
    },
  }
}

function success(stdout: string) {
  return { exitCode: 0, stdout, stderr: '' }
}

function moveExclusive(source: string, destination: string): void {
  linkSync(source, destination)
  unlinkSync(source)
}
