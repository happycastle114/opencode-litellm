import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { runCliProgram } from '../src/cli/program'
import { DISCOVERY, setupProgramHome } from './cli-program-test-support'

let dir = ''
setupProgramHome('opencode-litellm-program-install-', (path) => { dir = path })

describe('CLI program', () => {
  test('installs OpenCode configuration through the command surface', async () => {
    const path = join(dir, 'opencode.jsonc')
    const result = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', 'https://litellm.example.com',
      '--auth-env', 'LITELLM_API_KEY', '--auth', 'env', '--search', 'agy-search', '--mcp', 'zread',
      '--opencode-config', path, '--non-interactive',
    ], {
      env: { HOME: dir, LITELLM_API_KEY: 'test-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const config = parseJsonc(readFileSync(path, 'utf8'))
    expect(config.provider.litellm.options.apiKey).toBe('{env:LITELLM_API_KEY}')
    expect(config.plugin[0][1].mcpDiscovery.include).toEqual(['zread'])
    expect(JSON.parse(readFileSync(join(dir, '.config', 'opencode-litellm', 'launch.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      openCode: { gatewayOrigin: 'https://litellm.example.com', auth: 'env', authEnv: 'LITELLM_API_KEY', configPath: path },
      claude: { gatewayOrigin: 'https://litellm.example.com', auth: 'env', authEnv: 'LITELLM_API_KEY' },
    })
    const openCodeCalls: Array<{ readonly options: { readonly env: Readonly<Record<string, string | undefined>> } }> = []
    const openCodeLaunch = await runCliProgram(['opencode'], {
      env: {
        HOME: dir, LITELLM_API_KEY: 'runtime-key', OPENCODE_CONFIG: join(dir, 'ambient.json'),
        OPENCODE_CONFIG_DIR: join(dir, 'ambient'), OPENCODE_ENABLE_EXA: 'true', TRACE_ID: 'preserved-trace',
      },
      now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (_file, _args, options) => { openCodeCalls.push({ options }); return { status: 0, signal: null } },
      },
    })
    expect(openCodeLaunch.exitCode).toBe(0)
    expect(openCodeCalls[0]?.options.env.OPENCODE_CONFIG).toBe(path)
    expect(openCodeCalls[0]?.options.env.OPENCODE_CONFIG_DIR).toBe(dirname(path))
    expect(openCodeCalls[0]?.options.env.OPENCODE_ENABLE_EXA).toBeUndefined()
    expect(openCodeCalls[0]?.options.env.LITELLM_API_KEY).toBe('runtime-key')
    expect(openCodeCalls[0]?.options.env.TRACE_ID).toBe('preserved-trace')
    const unconfiguredCodex = await runCliProgram(['codex'], {
      env: { HOME: dir, LITELLM_API_KEY: 'test-key' }, now: () => new Date(0),
    })
    expect(unconfiguredCodex.exitCode).toBe(1)
    expect(unconfiguredCodex.stderr).toContain('Codex launch is not configured')
  })

  test('preflights the launch-state destination before mutating client files', async () => {
    const xdgConfigFile = join(dir, 'xdg-config-file')
    const opencodePath = join(dir, 'opencode.jsonc')
    writeFileSync(xdgConfigFile, 'not-a-directory\n')
    writeFileSync(opencodePath, '{"keep":true}\n')
    let discoveryCalls = 0
    const result = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', 'https://gateway.example.com',
      '--auth', 'env', '--auth-env', 'GATEWAY_KEY', '--opencode-config', opencodePath,
      '--non-interactive',
    ], {
      env: { HOME: dir, XDG_CONFIG_HOME: xdgConfigFile, GATEWAY_KEY: 'gateway-secret' },
      now: () => new Date(0),
      gatewayDiscovery: async () => { discoveryCalls += 1; return DISCOVERY },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('launch configuration cannot be written')
    expect(readFileSync(opencodePath, 'utf8')).toBe('{"keep":true}\n')
    expect(discoveryCalls).toBe(1)
  })

  test('refuses direct Codex launch for a non-config.toml override', async () => {
    const codexPath = join(dir, '.codex', 'custom.toml')
    const calls: Array<{ readonly file: string }> = []
    const install = await runCliProgram([
      'install', '--target', 'codex', '--base-url', 'https://codex.example.com',
      '--auth', 'env', '--auth-env', 'CODEX_GATEWAY_KEY', '--codex-mode', 'gateway',
      '--codex-config', codexPath, '--non-interactive',
    ], {
      env: { HOME: dir, CODEX_GATEWAY_KEY: 'codex-install-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })
    const launch = await runCliProgram(['codex', 'resume'], {
      env: { HOME: dir, CODEX_GATEWAY_KEY: 'codex-runtime-key' }, now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (file) => { calls.push({ file }); return { status: 0, signal: null } },
      },
    })
    expect(install.exitCode).toBe(1)
    expect(install.stderr).toContain('must end in')
    expect(existsSync(codexPath)).toBe(false)
    expect(existsSync(join(dir, '.config', 'opencode-litellm', 'launch.json'))).toBe(false)
    expect(launch.exitCode).toBe(1)
    expect(launch.stderr).toContain('launch configuration is missing')
    expect(calls).toHaveLength(0)
  })

  test('retires an unselected conflicting SSO launcher when the shared token origin changes', async () => {
    const openCodePath = join(dir, 'opencode.jsonc')
    const codexPath = join(dir, '.codex', 'config.toml')
    const tokenPath = join(dir, '.litellm', 'token.json')
    const originA = 'https://sso-a.example.com'
    const originB = 'https://sso-b.example.com'
    const secretA = 'sso-origin-a-secret'
    const secretB = 'sso-origin-b-secret'
    mkdirSync(join(dir, '.litellm'), { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({ base_url: originA, key: secretA }))
    const openInstall = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', originA, '--auth', 'sso',
      '--auth-env', 'SSO_GATEWAY_KEY', '--opencode-config', openCodePath,
      '--no-search', '--no-mcp', '--no-toolsets', '--non-interactive',
    ], { env: { HOME: dir }, now: () => new Date(0), gatewayDiscovery: async () => DISCOVERY })
    writeFileSync(tokenPath, JSON.stringify({ base_url: originB, key: secretB }))
    const codexInstall = await runCliProgram([
      'install', '--target', 'codex', '--base-url', originB, '--auth', 'sso',
      '--auth-env', 'SSO_GATEWAY_KEY', '--codex-mode', 'gateway', '--codex-config', codexPath,
      '--no-search', '--no-mcp', '--no-toolsets', '--non-interactive',
    ], { env: { HOME: dir }, now: () => new Date(0), gatewayDiscovery: async () => DISCOVERY })
    const launchState = JSON.parse(readFileSync(join(dir, '.config', 'opencode-litellm', 'launch.json'), 'utf8')) as {
      readonly openCode?: unknown
      readonly codex?: { readonly gatewayOrigin?: string; readonly auth?: string }
    }
    expect(openInstall.exitCode).toBe(0)
    expect(codexInstall.exitCode).toBe(0)
    expect(launchState.openCode).toBeUndefined()
    expect(launchState.codex).toMatchObject({ gatewayOrigin: originB, auth: 'sso' })
    expect(codexInstall.stdout).toContain('Retired previous OpenCode SSO launch state')
    expect(codexInstall.stdout).toContain("opencode-litellm install --target opencode")
    expect(`${openInstall.stdout}${codexInstall.stdout}${openInstall.stderr}${codexInstall.stderr}`).not.toContain(secretA)
    expect(`${openInstall.stdout}${codexInstall.stdout}${openInstall.stderr}${codexInstall.stderr}`).not.toContain(secretB)
  })

  test('rejects an invalid auth environment before changing client or launch state', async () => {
    const opencodePath = join(dir, 'invalid-opencode.jsonc')
    const codexPath = join(dir, 'invalid-codex', 'config.toml')
    const launchPath = join(dir, '.config', 'opencode-litellm', 'launch.json')
    mkdirSync(join(dir, 'invalid-codex'), { recursive: true })
    mkdirSync(join(dir, '.config', 'opencode-litellm'), { recursive: true })
    writeFileSync(opencodePath, '{"keep":true}\n')
    writeFileSync(codexPath, 'approval_policy = "on-request"\n')
    writeFileSync(launchPath, '{"sentinel":true}\n')
    const result = await runCliProgram([
      'install', '--target', 'both', '--base-url', 'https://custom.example.com',
      '--auth', 'env', '--auth-env', 'BAD-NAME', '--opencode-config', opencodePath,
      '--codex-config', codexPath, '--non-interactive',
    ], {
      env: { HOME: dir, 'BAD-NAME': 'invalid-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => { throw new Error('discovery should not run for invalid install options') },
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Invalid value 'BAD-NAME' for '--auth-env'.")
    expect(readFileSync(opencodePath, 'utf8')).toBe('{"keep":true}\n')
    expect(readFileSync(codexPath, 'utf8')).toBe('approval_policy = "on-request"\n')
    expect(readFileSync(launchPath, 'utf8')).toBe('{"sentinel":true}\n')
  })
})
