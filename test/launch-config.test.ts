import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LaunchConfigSchemaVersion,
  loadLaunchConfig,
  persistLaunchConfig,
  resolveLaunchConfigPath,
} from '../src/cli/launch-config'
import { CodexMode, InstallAuth } from '../src/cli/install-intent'

let home: string

const CONFIG = {
  schemaVersion: LaunchConfigSchemaVersion,
  openCode: {
    gatewayOrigin: 'https://custom.example.com/proxy',
    auth: InstallAuth.Environment,
    authEnv: 'CUSTOM_GATEWAY_KEY',
    configPath: '/tmp/opencode.jsonc',
  },
  claude: {
    gatewayOrigin: 'https://custom.example.com/proxy',
    auth: InstallAuth.Environment,
    authEnv: 'CUSTOM_GATEWAY_KEY',
  },
} as const

const CONFIG_WITH_CODEX = {
  ...CONFIG,
  codex: {
    gatewayOrigin: CONFIG.openCode.gatewayOrigin,
    auth: InstallAuth.Environment,
    authEnv: 'CUSTOM_GATEWAY_KEY',
    configPath: '/tmp/codex.toml',
    codexMode: CodexMode.Gateway,
  },
} as const

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'opencode-litellm-launch-config-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('LiteLLM launch configuration', () => {
  test('persists secret-free state atomically under XDG_CONFIG_HOME and reads it back', () => {
    const xdg = join(home, 'xdg')
    const sentinel = 'gateway-secret-sentinel'
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: xdg,
      CUSTOM_GATEWAY_KEY: sentinel,
    }
    const path = persistLaunchConfig(CONFIG, {
      env,
      now: () => new Date(0),
    })

    expect(path).toBe(join(xdg, 'opencode-litellm', 'launch.json'))
    expect(resolveLaunchConfigPath({ HOME: home, XDG_CONFIG_HOME: xdg })).toBe(path)
    expect(loadLaunchConfig({ env })).toEqual(CONFIG)
    expect(existsSync(path)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).not.toContain(sentinel)
  })

  test('falls back to HOME/.config and rejects non-canonical or unknown state', () => {
    const path = persistLaunchConfig(CONFIG, {
      env: { HOME: home },
      now: () => new Date(0),
    })
    expect(path).toBe(join(home, '.config', 'opencode-litellm', 'launch.json'))
    expect(loadLaunchConfig({ env: { HOME: home } })).toEqual(CONFIG)

    const malformed = `${JSON.stringify({
      ...CONFIG,
      openCode: { ...CONFIG.openCode, gatewayOrigin: `${CONFIG.openCode.gatewayOrigin}/` },
    })}\n`
    const unknown = `${JSON.stringify({ ...CONFIG, extra: 'secret-free' })}\n`
    rmSync(path)
    const directory = join(home, '.config', 'opencode-litellm')
    expect(existsSync(directory)).toBe(true)
    writeFileSync(path, malformed)
    expect(() => loadLaunchConfig({ env: { HOME: home } })).toThrow(/malformed/i)
    writeFileSync(path, unknown)
    expect(() => loadLaunchConfig({ env: { HOME: home } })).toThrow(/malformed/i)
  })

  test('persists exactly the allowed keys for each v1 launch state', () => {
    // Given: a valid v1 state with gateway authentication selected by environment
    const path = persistLaunchConfig(CONFIG_WITH_CODEX, {
      env: { HOME: home },
      now: () => new Date(0),
    })

    // When: the persisted document is inspected at its schema boundaries
    const persisted = JSON.parse(readFileSync(path, 'utf8'))

    // Then: only the published top-level and client-state keys are present
    expect(Object.keys(persisted).sort()).toEqual(['claude', 'codex', 'openCode', 'schemaVersion'])
    expect(Object.keys(persisted.openCode).sort()).toEqual([
      'auth',
      'authEnv',
      'configPath',
      'gatewayOrigin',
    ])
    expect(Object.keys(persisted.claude).sort()).toEqual([
      'auth',
      'authEnv',
      'gatewayOrigin',
    ])
    expect(Object.keys(persisted.codex).sort()).toEqual([
      'auth',
      'authEnv',
      'codexMode',
      'configPath',
      'gatewayOrigin',
    ])
  })

  test('rejects multiple distinct SSO origins when validating and loading state', () => {
    const conflicting = {
      schemaVersion: LaunchConfigSchemaVersion,
      openCode: {
        ...CONFIG.openCode,
        gatewayOrigin: 'https://open-sso.example.com',
        auth: InstallAuth.Sso,
      },
      codex: {
        gatewayOrigin: 'https://codex-sso.example.com',
        auth: InstallAuth.Sso,
        authEnv: 'CODEX_SSO_KEY',
        configPath: '/tmp/codex.toml',
        codexMode: CodexMode.Gateway,
      },
      claude: {
        ...CONFIG.claude,
        auth: InstallAuth.Environment,
      },
    } as const

    expect(() => persistLaunchConfig(conflicting, {
      env: { HOME: home },
      now: () => new Date(0),
    })).toThrow(/multiple distinct SSO gateway origins/i)

    const path = persistLaunchConfig(CONFIG, {
      env: { HOME: home },
      now: () => new Date(0),
    })
    writeFileSync(path, `${JSON.stringify(conflicting)}\n`)
    expect(() => loadLaunchConfig({ env: { HOME: home } })).toThrow(/multiple distinct SSO gateway origins/i)
  })
})
