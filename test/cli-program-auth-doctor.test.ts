import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCliProgram } from '../src/cli/program'
import { DISCOVERY, setupProgramHome } from './cli-program-test-support'

let dir = ''
setupProgramHome('opencode-litellm-program-auth-', (path) => { dir = path })

describe('CLI program', () => {
  test('fails direct launch safely when launch state is missing or malformed', async () => {
    const missing = await runCliProgram(['opencode'], { env: { HOME: dir }, now: () => new Date(0) })
    const path = join(dir, '.config', 'opencode-litellm', 'launch.json')
    mkdirSync(join(dir, '.config', 'opencode-litellm'), { recursive: true })
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1, gatewayOrigin: 'https://custom.example.com', auth: 'env', authEnv: 'CUSTOM_GATEWAY_KEY',
      codexMode: 'both', leaked: 'must-not-appear',
    }))
    const malformed = await runCliProgram(['opencode'], { env: { HOME: dir }, now: () => new Date(0) })
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('launch configuration is missing')
    expect(malformed.exitCode).toBe(1)
    expect(malformed.stderr).toContain('launch configuration')
    expect(malformed.stderr).toContain('malformed')
    expect(malformed.stderr).toContain('remove this file')
    expect(malformed.stderr).not.toContain('must-not-appear')
  })

  test('loads an exact-origin SSO token for direct Claude launch', async () => {
    const baseUrl = 'https://sso.custom.example.com/gateway'
    const secret = 'sso-program-secret'
    const tokenPath = join(dir, '.litellm', 'token.json')
    const configPath = join(dir, 'opencode.jsonc')
    const calls: Array<{ readonly options: { readonly env: Readonly<Record<string, string | undefined>> } }> = []
    mkdirSync(join(dir, '.litellm'), { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({ base_url: baseUrl, key: secret }))
    const install = await runCliProgram([
      'install', '--target', 'opencode', '--base-url', `${baseUrl}/`, '--auth', 'sso',
      '--auth-env', 'CUSTOM_SSO_KEY', '--opencode-config', configPath, '--non-interactive',
    ], {
      env: { HOME: dir, LITELLM_PROXY_URL: 'https://ambient.example.com', CUSTOM_SSO_KEY: 'ambient-sso-key' },
      now: () => new Date(0), gatewayDiscovery: async () => DISCOVERY,
    })
    const launch = await runCliProgram(['claude'], {
      env: { HOME: dir, LITELLM_PROXY_URL: 'https://ambient.example.com', CUSTOM_SSO_KEY: 'ambient-sso-key' },
      now: () => new Date(0),
      agentLaunchBoundary: {
        which: (command) => command,
        spawn: (_file, _args, options) => { calls.push({ options }); return { status: 0, signal: null } },
      },
    })
    expect(install.exitCode).toBe(0)
    expect(launch.exitCode).toBe(0)
    expect(calls[0]?.options.env.ANTHROPIC_BASE_URL).toBe(`${baseUrl}/claude-max`)
    expect(calls[0]?.options.env.ANTHROPIC_CUSTOM_HEADERS).toBe(`x-litellm-api-key: Bearer ${secret}`)
    expect(calls[0]?.options.env.CUSTOM_SSO_KEY).toBeUndefined()
    expect(readFileSync(join(dir, '.config', 'opencode-litellm', 'launch.json'), 'utf8')).not.toContain(secret)
  })

  test('returns a machine-readable doctor report without changing the file', async () => {
    const path = join(dir, 'opencode.jsonc')
    await runCliProgram([
      'install', '--target', 'opencode', '--base-url', 'https://litellm.example.com',
      '--auth', 'env', '--auth-env', 'LITELLM_API_KEY', '--opencode-config', path, '--non-interactive',
    ], {
      env: { HOME: dir, LITELLM_API_KEY: 'test-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })
    const before = readFileSync(path, 'utf8')
    const result = await runCliProgram([
      'doctor', '--target', 'opencode', '--opencode-config', path, '--json',
    ], { env: { HOME: dir }, now: () => new Date(0) })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).status).toBe('ok')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  test('owns login, safe whoami, and exact logout through one lifecycle surface', async () => {
    const baseUrl = 'https://litellm.example.com'
    const tokenPath = join(dir, '.litellm', 'token.json')
    const helperPath = join(dir, '.codex', 'libexec', 'litellm-auth-token.mjs')
    const secret = 'sk-program-lifecycle-secret'
    const authEnv = 'PROGRAM_LITELLM_PROXY_KEY'
    const processCalls: Array<{ readonly file: string; readonly args: readonly string[] }> = []
    mkdirSync(join(dir, '.codex', 'libexec'), { recursive: true })
    writeFileSync(helperPath, '#!/usr/bin/env node\n')
    const context = {
      env: { HOME: dir }, now: () => new Date(1_234_000), externalSetup: true, platform: 'darwin' as const,
      codexSpawnBoundary: {
        spawn: (file: string, args: readonly string[]) => {
          processCalls.push({ file, args }); return { status: 0, signal: null, stdout: '', stderr: '' }
        },
      },
      ssoBoundaries: { open: async () => undefined, selectTeam: async () => undefined },
      ssoOnboarding: async (input: { readonly tokenFilePath?: string }) => {
        expect(input.tokenFilePath).toBe(tokenPath)
        mkdirSync(join(dir, '.litellm'), { recursive: true })
        writeFileSync(tokenPath, JSON.stringify({
          base_url: baseUrl, key: secret, user_id: 'program-user', user_role: 'cli', timestamp: 1234,
        }))
        return { status: 'authenticated' as const }
      },
    }
    const lifecycleOptions = ['--base-url', baseUrl, '--auth-env', authEnv] as const
    const login = await runCliProgram(['login', ...lifecycleOptions], context)
    const whoami = await runCliProgram(['whoami', ...lifecycleOptions], context)
    const logout = await runCliProgram(['logout', ...lifecycleOptions], context)
    expect(login.exitCode).toBe(0)
    expect(JSON.parse(whoami.stdout)).toMatchObject({ status: 'authenticated', tokenPresent: true, userId: 'program-user' })
    expect(`${login.stdout}${whoami.stdout}${logout.stdout}`).not.toContain(secret)
    expect(existsSync(tokenPath)).toBe(false)
    expect(processCalls).toEqual([
      { file: process.execPath, args: [helperPath, '--launchctl-setenv', authEnv] },
      { file: '/bin/launchctl', args: ['unsetenv', authEnv] },
    ])
  })

  test('reports partial logout when the macOS session credential cannot be cleared', async () => {
    const tokenDirectory = join(dir, '.litellm')
    const tokenPath = join(tokenDirectory, 'token.json')
    mkdirSync(tokenDirectory, { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({ base_url: 'https://litellm.example.com', key: 'sk-partial-logout-secret' }))
    const result = await runCliProgram(['logout', '--auth-env', 'CUSTOM_PROXY_KEY'], {
      env: { HOME: dir }, now: () => new Date(0), externalSetup: true, platform: 'darwin',
      codexSpawnBoundary: { spawn: () => ({ status: 1, signal: null, stdout: '', stderr: '' }) },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('session removed')
    expect(result.stderr).toContain('/bin/launchctl unsetenv CUSTOM_PROXY_KEY')
    expect(result.stderr).not.toContain('sk-partial-logout-secret')
    expect(existsSync(tokenPath)).toBe(false)
  })
})
