import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  ApiKey: 'signal-test-key',
  AuthEnvironment: 'SIGNAL_GATEWAY_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const
const SIGNAL = {
  Interrupt: 'SIGINT',
  Terminate: 'SIGTERM',
  Unknown: 'SIGUNKNOWN',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'program-signal-exit-'))
  const launchPath = join(homeDirectory, '.config', 'opencode-litellm', 'launch.json')
  mkdirSync(dirname(launchPath), { recursive: true })
  writeFileSync(launchPath, `${JSON.stringify({
    schemaVersion: 1,
    openCode: {
      gatewayOrigin: VALUE.GatewayOrigin,
      auth: 'env',
      authEnv: VALUE.AuthEnvironment,
      configPath: join(homeDirectory, '.config', 'opencode', 'opencode.jsonc'),
    },
    claude: {
      gatewayOrigin: VALUE.GatewayOrigin,
      auth: 'env',
      authEnv: VALUE.AuthEnvironment,
    },
  })}\n`)
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('packed launcher signal exit status', () => {
  test.each([
    [SIGNAL.Interrupt, 130],
    [SIGNAL.Terminate, 143],
    [SIGNAL.Unknown, 128],
  ] as const)('maps %s to exit code %d', async (signal, expected) => {
    // Given: an installed launch state and a child terminated by a signal
    // When: the public packed-launcher surface receives that process result
    const result = await runCliProgram(['opencode'], {
      env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
      now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: () => ({ status: null, signal }),
      },
    })

    // Then: the shell-visible status follows the POSIX signal convention
    expect(result.exitCode).toBe(expected)
  })
})
