import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  ApiKey: 'recovery-warning-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
  TransactionId: '00000000-0000-4000-8000-000000000001',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-install-recovery-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('client install recovery reporting', () => {
  test('warns with the exact recoverable orphan path after convergence', async () => {
    // Given: a recognizable rollback orphan from an abruptly killed transaction
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const recoveryPath = `${configPath}.${VALUE.TransactionId}.rollback.tmp`
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{}\n')
    writeFileSync(recoveryPath, '{"exact":"old"}\n')

    // When: the public installer reruns to completion
    const result = await runCliProgram([
      'install',
      '--target', 'opencode',
      '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env',
      '--auth-env', VALUE.AuthEnvironment,
      '--opencode-config', configPath,
      '--non-interactive',
      '--no-search',
      '--no-mcp',
      '--no-toolsets',
    ], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      externalSetup: false,
      gatewayDiscovery: async () => ({
        models: [{ id: 'gateway-model' }],
        searchToolNames: [],
        mcpServerNames: [],
        toolsets: [],
        warnings: [],
      }),
    })

    // Then: active JSON is valid and the exact original is preserved and reported
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toBeObject()
    expect(readFileSync(recoveryPath, 'utf8')).toBe('{"exact":"old"}\n')
    expect(result.stdout).toContain(recoveryPath)
  })
})
