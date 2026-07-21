import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../src/cli/program'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'

const MANAGED_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: 'f97a800d7ce1dd204a2cfe0c51b7149428ecdff4',
} as const
const VALUE = {
  ApiKey: 'managed-rollback-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'managed-plugin-rollback-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('managed plugin activation rollback', () => {
  test('does not stage mutable client files before managed preparation completes', async () => {
    // Given: an existing client config and interrupted immutable checkout preparation
    const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const original = '{\n  "keep": "opencode"\n}\n'
    mkdirSync(dirname(openCodePath), { recursive: true })
    writeFileSync(openCodePath, original)

    // When: the managed clone command reports an interruption
    const result = await runCliProgram([
      'install',
      '--target', 'opencode',
      '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env',
      '--auth-env', VALUE.AuthEnvironment,
      '--opencode-config', openCodePath,
      '--non-interactive',
      '--no-search',
      '--no-mcp',
      '--no-toolsets',
    ], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      externalSetup: true,
      gatewayDiscovery: successfulDiscovery,
      managedPluginBoundary: {
        fs: { exists: () => false, isFile: () => true, remove: () => {} },
        command: {
          run: async () => ({ exitCode: 130, stdout: '', stderr: 'interrupted' }),
        },
      },
    })

    // Then: no mutable stage, backup, launch state, or client byte is left behind
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('interrupted')
    expect(readFileSync(openCodePath, 'utf8')).toBe(original)
    expect(recursiveNames(homeDirectory).some((name) => name.includes('.tmp'))).toBe(false)
    expect(recursiveNames(homeDirectory).some((name) => name.endsWith('.bak'))).toBe(false)
    expect(existsSync(resolveLaunchConfigPath({ HOME: homeDirectory }))).toBe(false)
  })

  test.each([
    ['new', false],
    ['existing', true],
  ] as const)(
    'preserves an immutable %s revision after a later filesystem failure',
    async (_kind, preExisting) => {
      // Given: a staged client transaction and a managed revision classification
      const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
      const original = '{\n  "keep": "opencode"\n}\n'
      mkdirSync(dirname(openCodePath), { recursive: true })
      writeFileSync(openCodePath, original)
      chmodSync(openCodePath, 0o640)
      const checkoutPath = join(
        dirname(openCodePath),
        'vendor',
        'opencode-litellm-git',
        MANAGED_PLUGIN.revision,
      )
      const managed = createManagedBoundary(checkoutPath, preExisting)
      let injected = false

      // When: plugin activation succeeds but the first file promotion fails
      const result = await runCliProgram([
        'install',
        '--target', 'opencode',
        '--base-url', VALUE.GatewayOrigin,
        '--auth', 'env',
        '--auth-env', VALUE.AuthEnvironment,
        '--opencode-config', openCodePath,
        '--non-interactive',
        '--no-search',
        '--no-mcp',
        '--no-toolsets',
      ], {
        env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
        now: () => new Date(0),
        externalSetup: true,
        gatewayDiscovery: successfulDiscovery,
        managedPluginBoundary: managed.boundary,
        clientInstallCommitBoundary: {
          moveExclusive: (source, destination) => {
            if (!injected && destination === openCodePath && source !== openCodePath) {
              injected = true
              throw new Error('injected client promotion failure')
            }
            renameSync(source, destination)
          },
        },
      })

      // Then: client state rolls back while the content-addressed checkout remains reusable
      expect(result.exitCode).toBe(1)
      expect(injected).toBe(true)
      expect(readFileSync(openCodePath, 'utf8')).toBe(original)
      expect(statSync(openCodePath).mode & 0o777).toBe(0o640)
      expect(readdirSync(dirname(openCodePath)).some((name) => name.endsWith('.bak'))).toBe(false)
      expect(managed.existingPaths.has(checkoutPath)).toBe(true)
      expect(managed.removedPaths.includes(checkoutPath)).toBe(false)
      expect(existsSync(resolveLaunchConfigPath({ HOME: homeDirectory }))).toBe(false)
    },
  )
})

function createManagedBoundary(checkoutPath: string, preExisting: boolean) {
  const existingPaths = new Set(preExisting ? [checkoutPath] : [])
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

function recursiveNames(path: string): readonly string[] {
  return readdirSync(path, { recursive: true }).map((entry) => entry.toString())
}

async function successfulDiscovery() {
  return {
    models: [{ id: 'gateway-model' }],
    searchToolNames: [],
    mcpServerNames: [],
    toolsets: [],
    warnings: [],
  }
}
