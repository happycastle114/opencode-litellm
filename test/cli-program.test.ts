import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { runCliProgram } from '../src/cli/program'

const DISCOVERY = {
  models: [{ id: 'coding-fast' }],
  searchToolNames: ['agy-search'],
  mcpServerNames: ['zread'],
  toolsets: [],
  warnings: [],
} as const

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opencode-litellm-program-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('CLI program', () => {
  test('installs OpenCode configuration through the command surface', async () => {
    // Given: an isolated config path and a complete non-interactive invocation
    const path = join(dir, 'opencode.jsonc')

    // When: the installer command runs
    const result = await runCliProgram([
      'install',
      '--target',
      'opencode',
      '--base-url',
      'https://litellm.example.com',
      '--auth-env',
      'LITELLM_API_KEY',
      '--auth',
      'env',
      '--search',
      'agy-search',
      '--mcp',
      'zread',
      '--opencode-config',
      path,
      '--non-interactive',
    ], {
      env: { HOME: dir, LITELLM_API_KEY: 'test-key' },
      now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })

    // Then: the public result succeeds and the generated file contains references only
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const config = parseJsonc(readFileSync(path, 'utf8'))
    expect(config.provider.litellm.options.apiKey).toBe('{env:LITELLM_API_KEY}')
    expect(config.plugin[0][1].mcpDiscovery.include).toEqual(['zread'])
  })

  test('returns a machine-readable doctor report without changing the file', async () => {
    // Given: an installed config
    const path = join(dir, 'opencode.jsonc')
    await runCliProgram([
      'install', '--target', 'opencode', '--base-url', 'https://litellm.example.com',
      '--auth', 'env', '--auth-env', 'LITELLM_API_KEY', '--opencode-config', path,
      '--non-interactive',
    ], {
      env: { HOME: dir, LITELLM_API_KEY: 'test-key' },
      now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY,
    })
    const before = readFileSync(path, 'utf8')

    // When: doctor runs in JSON mode
    const result = await runCliProgram([
      'doctor', '--target', 'opencode', '--opencode-config', path, '--json',
    ], { env: { HOME: dir }, now: () => new Date(0) })

    // Then: it succeeds, emits JSON, and leaves the file untouched
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).status).toBe('ok')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  test('owns login, safe whoami, and exact logout through one lifecycle surface', async () => {
    // Given: an injected browser boundary and a source-compatible successful SSO result
    const baseUrl = 'https://litellm.example.com'
    const tokenPath = join(dir, '.litellm', 'token.json')
    const helperPath = join(dir, '.codex', 'libexec', 'litellm-auth-token.mjs')
    const secret = 'sk-program-lifecycle-secret'
    const authEnv = 'PROGRAM_LITELLM_PROXY_KEY'
    const processCalls: Array<{ readonly file: string; readonly args: readonly string[] }> = []
    mkdirSync(join(dir, '.codex', 'libexec'), { recursive: true })
    writeFileSync(helperPath, '#!/usr/bin/env node\n')
    const context = {
      env: { HOME: dir },
      now: () => new Date(1_234_000),
      externalSetup: true,
      platform: 'darwin',
      codexSpawnBoundary: {
        spawn: (file: string, args: readonly string[]) => {
          processCalls.push({ file, args })
          return { status: 0, signal: null, stdout: '', stderr: '' }
        },
      },
      ssoBoundaries: {
        open: async () => undefined,
        selectTeam: async () => undefined,
      },
      ssoOnboarding: async (input: { readonly tokenFilePath?: string }) => {
        expect(input.tokenFilePath).toBe(tokenPath)
        mkdirSync(join(dir, '.litellm'), { recursive: true })
        writeFileSync(tokenPath, JSON.stringify({
          base_url: baseUrl,
          key: secret,
          user_id: 'program-user',
          user_role: 'cli',
          timestamp: 1234,
        }))
        return { status: 'authenticated' as const }
      },
    }

    // When: login, metadata inspection, and logout run sequentially
    const lifecycleOptions = ['--base-url', baseUrl, '--auth-env', authEnv] as const
    const login = await runCliProgram(['login', ...lifecycleOptions], context)
    const whoami = await runCliProgram(['whoami', ...lifecycleOptions], context)
    const logout = await runCliProgram(['logout', ...lifecycleOptions], context)

    // Then: the key never appears and only the exact official token is removed
    expect(login.exitCode).toBe(0)
    expect(JSON.parse(whoami.stdout)).toMatchObject({
      status: 'authenticated',
      tokenPresent: true,
      userId: 'program-user',
    })
    expect(`${login.stdout}${whoami.stdout}${logout.stdout}`).not.toContain(secret)
    expect(existsSync(tokenPath)).toBe(false)
    expect(processCalls).toEqual([
      {
        file: process.execPath,
        args: [helperPath, '--launchctl-setenv', authEnv],
      },
      {
        file: '/bin/launchctl',
        args: ['unsetenv', authEnv],
      },
    ])
  })

  test('reports partial logout when the macOS session credential cannot be cleared', async () => {
    const tokenDirectory = join(dir, '.litellm')
    const tokenPath = join(tokenDirectory, 'token.json')
    mkdirSync(tokenDirectory, { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({
      base_url: 'https://litellm.example.com',
      key: 'sk-partial-logout-secret',
    }))

    const result = await runCliProgram([
      'logout', '--auth-env', 'CUSTOM_PROXY_KEY',
    ], {
      env: { HOME: dir },
      now: () => new Date(0),
      externalSetup: true,
      platform: 'darwin',
      codexSpawnBoundary: {
        spawn: () => ({ status: 1, signal: null, stdout: '', stderr: '' }),
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('session removed')
    expect(result.stderr).toContain('/bin/launchctl unsetenv CUSTOM_PROXY_KEY')
    expect(result.stderr).not.toContain('sk-partial-logout-secret')
    expect(existsSync(tokenPath)).toBe(false)
  })
})
