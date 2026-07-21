import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../src/cli/program'
import { bundledCodexCatalogBoundary, DISCOVERY, setupProgramHome } from './cli-program-test-support'

let dir = ''
setupProgramHome('opencode-litellm-program-launch-', (path) => { dir = path })

describe('CLI program', () => {
  test('loads the installed custom origin and auth environment for direct Codex launch', async () => {
    const configPath = join(dir, 'opencode.jsonc')
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: { readonly env: Readonly<Record<string, string | undefined>> } }> = []
    const install = await runCliProgram([
      'install', '--target', 'both', '--base-url', 'https://custom.example.com/proxy/',
      '--auth-env', 'CUSTOM_GATEWAY_KEY', '--codex-mode', 'both', '--opencode-config', configPath,
      '--non-interactive',
    ], {
      env: { HOME: dir, CUSTOM_GATEWAY_KEY: 'custom-install-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
      codexSpawnBoundary: bundledCodexCatalogBoundary(),
    })
    const launch = await runCliProgram(['codex', 'resume'], {
      env: { HOME: dir, CUSTOM_GATEWAY_KEY: 'custom-runtime-key', LITELLM_PROXY_URL: 'https://ambient.example.com' },
      now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (file, args, options) => { calls.push({ file, args, options }); return { status: 0, signal: null } },
      },
    })
    const explicitOAuthProfile = await runCliProgram(['codex', '--profile', 'codex-oauth'], {
      env: { HOME: dir, CUSTOM_GATEWAY_KEY: 'custom-runtime-key' }, now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (file, args, options) => { calls.push({ file, args, options }); return { status: 0, signal: null } },
      },
    })
    expect(install.exitCode).toBe(0)
    expect(existsSync(join(dir, '.codex', 'codex-oauth.config.toml'))).toBe(true)
    expect(readFileSync(join(dir, '.codex', 'codex-oauth.config.toml'), 'utf8')).toContain(
      'base_url = "https://custom.example.com/proxy/codex-oauth"',
    )
    expect(launch.exitCode).toBe(0)
    expect(explicitOAuthProfile.exitCode).toBe(0)
    expect(calls[0]?.args).toEqual(['resume'])
    expect(calls[1]?.args).toEqual(['--profile', 'codex-oauth'])
    expect(calls[0]?.options.env.CODEX_HOME).toBe(join(dir, '.codex'))
    expect(calls[0]?.options.env.CUSTOM_GATEWAY_KEY).toBe('custom-runtime-key')
    expect(calls[0]?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.LITELLM_PROXY_URL).toBe('https://ambient.example.com')
  })

  test('refuses an OpenCode launch after a Codex-only install', async () => {
    const codexPath = join(dir, '.codex', 'config.toml')
    const install = await runCliProgram([
      'install', '--target', 'codex', '--base-url', 'https://codex.example.com',
      '--auth-env', 'CODEX_GATEWAY_KEY', '--codex-mode', 'gateway', '--codex-config', codexPath,
      '--non-interactive',
    ], {
      env: { HOME: dir, CODEX_GATEWAY_KEY: 'codex-install-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
      codexSpawnBoundary: bundledCodexCatalogBoundary(),
    })
    const launch = await runCliProgram(['opencode'], {
      env: { HOME: dir, CODEX_GATEWAY_KEY: 'codex-runtime-key' }, now: () => new Date(0),
    })
    expect(install.exitCode).toBe(0)
    expect(launch.exitCode).toBe(1)
    expect(launch.stderr).toContain('OpenCode launch is not configured')
  })

  test('merges sequential client installs and keeps per-client launch paths', async () => {
    const openCodePath = join(dir, 'configs', 'open-code.jsonc')
    const codexPath = join(dir, 'configs', 'codex', 'config.toml')
    const openInstall = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', 'https://open.example.com',
      '--auth-env', 'OPEN_GATEWAY_KEY', '--no-search', '--opencode-config', openCodePath,
      '--non-interactive',
    ], {
      env: { HOME: dir, OPEN_GATEWAY_KEY: 'open-install-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })
    const codexInstall = await runCliProgram([
      'install', '--target', 'codex', '--base-url', 'https://codex.example.com',
      '--auth-env', 'CODEX_GATEWAY_KEY', '--codex-mode', 'gateway', '--codex-config', codexPath,
      '--non-interactive',
    ], {
      env: { HOME: dir, CODEX_GATEWAY_KEY: 'codex-install-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
      codexSpawnBoundary: bundledCodexCatalogBoundary(),
    })
    const openCalls: Array<{ readonly options: { readonly env: Readonly<Record<string, string | undefined>> } }> = []
    const codexCalls: Array<{ readonly options: { readonly env: Readonly<Record<string, string | undefined>> } }> = []
    const openRuntimeEnvironment = {
      HOME: dir, OPEN_GATEWAY_KEY: 'open-runtime-key', LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
      LITELLM_API_KEY: 'ambient-litellm-key', LITELLM_MASTER_KEY: 'ambient-master-key',
      OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key', OPENCODE_CONFIG: join(dir, 'ambient.json'),
      OPENCODE_CONFIG_DIR: join(dir, 'ambient'), OPENCODE_ENABLE_EXA: 'true',
      ANTHROPIC_API_KEY: 'ambient-anthropic-key', OPENAI_API_KEY: 'ambient-openai-key', TRACE_ID: 'preserved-trace',
    } as const
    const openLaunch = await runCliProgram(['opencode'], {
      env: openRuntimeEnvironment, now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (_file, _args, options) => { openCalls.push({ options }); return { status: 0, signal: null } },
      },
    })
    const codexLaunch = await runCliProgram(['codex', 'resume'], {
      env: {
        HOME: dir, CODEX_GATEWAY_KEY: 'codex-runtime-key', LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
        LITELLM_API_KEY: 'ambient-litellm-key', LITELLM_MASTER_KEY: 'ambient-master-key',
        OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key', ANTHROPIC_API_KEY: 'ambient-anthropic-key',
      },
      now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (_file, _args, options) => { codexCalls.push({ options }); return { status: 0, signal: null } },
      },
    })
    const launchStateSource = readFileSync(join(dir, '.config', 'opencode-litellm', 'launch.json'), 'utf8')
    const launchState = JSON.parse(launchStateSource)
    expect(openInstall.exitCode).toBe(0)
    expect(codexInstall.exitCode).toBe(0)
    expect(openLaunch.exitCode).toBe(0)
    expect(codexLaunch.exitCode).toBe(0)
    expect(openCalls[0]?.options.env.OPENCODE_CONFIG).toBe(openCodePath)
    expect(openCalls[0]?.options.env.OPENCODE_CONFIG_DIR).toBe(dirname(openCodePath))
    expect(openCalls[0]?.options.env.OPENCODE_ENABLE_EXA).toBeUndefined()
    expect(openCalls[0]?.options.env.OPENCODE_LITELLM_API_KEY).toBe('open-runtime-key')
    expect(openCalls[0]?.options.env.OPEN_GATEWAY_KEY).toBe('open-runtime-key')
    expect(openCalls[0]?.options.env.ANTHROPIC_API_KEY).toBe('ambient-anthropic-key')
    expect(openCalls[0]?.options.env.OPENAI_API_KEY).toBe('ambient-openai-key')
    expect(openCalls[0]?.options.env.TRACE_ID).toBe('preserved-trace')
    expect(openCalls[0]?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(openCalls[0]?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(openRuntimeEnvironment.OPEN_GATEWAY_KEY).toBe('open-runtime-key')
    expect(openRuntimeEnvironment.OPENCODE_LITELLM_API_KEY).toBe('ambient-opencode-key')
    expect(codexCalls[0]?.options.env.CODEX_HOME).toBe(dirname(codexPath))
    expect(codexCalls[0]?.options.env.CODEX_GATEWAY_KEY).toBe('codex-runtime-key')
    expect(codexCalls[0]?.options.env.ANTHROPIC_API_KEY).toBe('ambient-anthropic-key')
    expect(codexCalls[0]?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(codexCalls[0]?.options.env.LITELLM_API_KEY).toBeUndefined()
    expect(codexCalls[0]?.options.env.LITELLM_MASTER_KEY).toBeUndefined()
    expect(launchState.openCode).toMatchObject({ gatewayOrigin: 'https://open.example.com', authEnv: 'OPEN_GATEWAY_KEY', configPath: openCodePath })
    expect(launchState.codex).toMatchObject({ gatewayOrigin: 'https://codex.example.com', authEnv: 'CODEX_GATEWAY_KEY', configPath: codexPath, codexMode: 'gateway' })
    expect(launchState.claude.gatewayOrigin).toBe('https://codex.example.com')
    expect(launchStateSource).not.toContain('open-install-key')
    expect(launchStateSource).not.toContain('codex-install-key')
  })
})
