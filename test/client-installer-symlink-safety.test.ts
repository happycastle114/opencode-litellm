import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import { runCliProgram } from '../src/cli/program'

const VALUE = {
  ApiKey: 'symlink-safety-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

let homeDirectory: string
let externalDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-symlink-home-'))
  externalDirectory = mkdtempSync(join(tmpdir(), 'client-symlink-target-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
  rmSync(externalDirectory, { recursive: true, force: true })
})

describe('client installer symlink safety', () => {
  test('rejects an SSO token symlink before opening the browser boundary', async () => {
    // Given: the official token leaf links to an external credential file
    const targetPath = join(externalDirectory, 'token.json')
    const tokenPath = join(homeDirectory, '.litellm', 'token.json')
    const targetSource = '{"base_url":"https://external.test","key":"external-key"}\n'
    mkdirSync(dirname(tokenPath), { recursive: true })
    writeFileSync(targetPath, targetSource)
    symlinkSync(targetPath, tokenPath)
    let browserCalls = 0

    // When: interactive SSO installation preflights its token destination
    const result = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', VALUE.GatewayOrigin,
      '--auth', 'sso', '--no-search', '--no-mcp', '--no-toolsets',
    ], {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      onboardingIO: { isTTY: true, prompt: async () => '', write: () => undefined },
      ssoBoundaries: {
        open: async () => { browserCalls += 1 },
        selectTeam: async () => undefined,
      },
    })

    // Then: it fails before authentication and preserves the link target exactly
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('regular file or absent')
    expect(browserCalls).toBe(0)
    expect(lstatSync(tokenPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(tokenPath)).toBe(targetPath)
    expect(readFileSync(targetPath, 'utf8')).toBe(targetSource)
    expect(existsSync(resolveLaunchConfigPath({ HOME: homeDirectory }))).toBe(false)
  })

  test('rejects a Claude settings symlink without changing its target or other assets', async () => {
    // Given: Claude settings links to an external regular file
    const targetPath = join(externalDirectory, 'settings.json')
    const settingsPath = join(homeDirectory, '.claude', 'settings.json')
    const targetSource = '{\n  "external": true\n}\n'
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(targetPath, targetSource)
    chmodSync(targetPath, 0o644)
    symlinkSync(targetPath, settingsPath)
    const beforeMode = statSync(targetPath).mode & 0o777

    // When: installation reaches the public transaction surface
    const result = await installOpenCode()

    // Then: it fails closed without replacing the link or touching external/client state
    expect(result.exitCode).toBe(1)
    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(settingsPath)).toBe(targetPath)
    expect(readFileSync(targetPath, 'utf8')).toBe(targetSource)
    expect(statSync(targetPath).mode & 0o777).toBe(beforeMode)
    expect(existsSync(join(homeDirectory, '.config', 'opencode', 'opencode.jsonc'))).toBe(false)
    expect(existsSync(join(homeDirectory, '.config', 'opencode-litellm', 'launch.json'))).toBe(false)
  })

  test('rejects an SSO token parent symlink before opening the browser boundary', async () => {
    // Given: the managed token directory redirects into an external directory
    const tokenDirectory = join(homeDirectory, '.litellm')
    symlinkSync(externalDirectory, tokenDirectory)
    let browserCalls = 0

    // When: interactive SSO installation attempts to snapshot the token destination
    const result = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', VALUE.GatewayOrigin,
      '--auth', 'sso', '--no-search', '--no-mcp', '--no-toolsets',
    ], {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      onboardingIO: { isTTY: true, prompt: async () => '', write: () => undefined },
      ssoBoundaries: {
        open: async () => { browserCalls += 1 },
        selectTeam: async () => undefined,
      },
    })

    // Then: traversal is rejected before authentication or external writes
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('regular file or absent')
    expect(browserCalls).toBe(0)
    expect(lstatSync(tokenDirectory).isSymbolicLink()).toBe(true)
    expect(readlinkSync(tokenDirectory)).toBe(externalDirectory)
    expect(existsSync(join(externalDirectory, 'token.json'))).toBe(false)
  })

  test('rejects a FIFO managed parent without opening or replacing it', async () => {
    // Given: the OpenCode managed parent is a FIFO instead of a directory
    const configParent = join(homeDirectory, '.config')
    execFileSync('mkfifo', [configParent])

    // When: installation preflights its managed destinations
    const result = await installOpenCode()

    // Then: it fails closed and leaves the special entry intact
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('cannot be written')
    expect(lstatSync(configParent).isFIFO()).toBe(true)
  })
})

async function installOpenCode() {
  return runCliProgram([
    'install', '--target', 'opencode', '--base-url', VALUE.GatewayOrigin,
    '--auth', 'env', '--auth-env', VALUE.AuthEnvironment, '--non-interactive',
    '--no-search', '--no-mcp', '--no-toolsets',
  ], {
    env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
    now: () => new Date(0),
    gatewayDiscovery: async () => ({
      models: [], searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [],
    }),
  })
}
