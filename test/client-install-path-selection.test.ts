import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import { runCliProgram } from '../src/cli/program'

const MANAGED_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: 'f97a800d7ce1dd204a2cfe0c51b7149428ecdff4',
} as const
const VALUE = {
  ApiKey: 'path-selection-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-path-selection-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('client path selection guard', () => {
  test('aborts when a higher-priority OpenCode candidate appears asynchronously', async () => {
    // Given: JSON is selected while its higher-priority JSONC candidate is absent
    const jsonPath = join(homeDirectory, '.config', 'opencode', 'opencode.json')
    const jsoncPath = join(dirname(jsonPath), 'opencode.jsonc')
    const original = '{\n  "keep": "json"\n}\n'
    mkdirSync(dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, original)
    let injected = false

    // When: managed verification asynchronously creates the higher-priority candidate
    const result = await runCliProgram([
      'install',
      '--target', 'opencode',
      '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env',
      '--auth-env', VALUE.AuthEnvironment,
      '--non-interactive',
      '--no-search',
      '--no-mcp',
      '--no-toolsets',
    ], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      externalSetup: true,
      gatewayDiscovery: async () => ({
        models: [{ id: 'gateway-model' }],
        searchToolNames: [],
        mcpServerNames: [],
        toolsets: [],
        warnings: [],
      }),
      managedPluginBoundary: {
        fs: { exists: () => true, isFile: () => true },
        command: {
          run: async (invocation) => {
            if (!injected) {
              injected = true
              writeFileSync(jsoncPath, '{"foreign":true}\n')
            }
            if (invocation.args.includes('get-url')) {
              return success(`${MANAGED_PLUGIN.repository}\n`)
            }
            if (invocation.args.includes('rev-parse')) {
              return success(`${MANAGED_PLUGIN.revision}\n`)
            }
            return success('')
          },
        },
      },
    })

    // Then: neither selected config nor any additional mutable asset is committed
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('changed during installation')
    expect(readFileSync(jsonPath, 'utf8')).toBe(original)
    expect(readFileSync(jsoncPath, 'utf8')).toBe('{"foreign":true}\n')
    expect(existsSync(resolveLaunchConfigPath({ HOME: homeDirectory }))).toBe(false)
  })
})

function success(stdout: string) {
  return { exitCode: 0, stdout, stderr: '' }
}
