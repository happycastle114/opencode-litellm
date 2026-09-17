import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { createInstallApiKeyContext, planInstallApiKeyAsset } from '../src/cli/install-api-key'
import { InstallAuth } from '../src/cli/install-intent'
import { loadEnvKey, resolveManualLiteLLMApiKeyPath } from '../src/cli/official-token'
import { runCliProgram } from '../src/cli/program'
import { bundledCatalog, preparedInstall, VALUE } from './client-installer-test-support'

let homeDirectory: string
let configDirectory: string
let nativeTokenPath: string
const NATIVE_METADATA = '{"base_url":"https://native.example.test"}\n'

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-api-key-'))
  configDirectory = join(homeDirectory, 'custom-config')
  nativeTokenPath = join(homeDirectory, '.litellm', 'token.json')
  mkdirSync(dirname(nativeTokenPath), { recursive: true })
  writeFileSync(nativeTokenPath, NATIVE_METADATA)
})
afterEach(() => { rmSync(homeDirectory, { recursive: true, force: true }) })

describe('manual API-key installation', () => {
  test('commits only the dedicated private store and retains its helper on reinstall', async () => {
    const env = { HOME: homeDirectory, XDG_CONFIG_HOME: configDirectory }
    const apiKeyFilePath = resolveManualLiteLLMApiKeyPath(env)
    const answers = ['', '', '', '', VALUE.ApiKey, '', 'y']
    const boundary = {
      env, now: () => new Date(0), bundledCodexCatalog: bundledCatalog,
      gatewayDiscovery: async () => preparedInstall({}).discovery,
      onboardingIO: {
        isTTY: true, write: () => undefined,
        prompt: async () => {
          const answer = answers.shift()
          if (answer === undefined) throw new Error('Unexpected onboarding prompt.')
          return answer
        },
      },
    }
    const args = ['install', '--target', 'codex', '--base-url', VALUE.GatewayOrigin,
      '--auth', 'env', '--codex-mode', 'gateway', '--auto-router', 'skip',
      '--no-search', '--no-mcp', '--no-toolsets']
    const first = await runCliProgram(args, boundary)
    expect(first.exitCode).toBe(0)
    expect(answers).toHaveLength(0)
    expect(loadEnvKey(apiKeyFilePath, VALUE.GatewayOrigin)).toBe(VALUE.ApiKey)
    expect(readFileSync(nativeTokenPath, 'utf8')).toBe(NATIVE_METADATA)
    expect(readdirSync(dirname(apiKeyFilePath)).sort()).toEqual(['api-key.json', 'launch.json'])
    if (process.platform !== 'win32') expect(statSync(apiKeyFilePath).mode & 0o777).toBe(0o600)
    const configPath = join(homeDirectory, '.codex', 'config.toml')
    const firstConfig = readFileSync(configPath, 'utf8')
    const firstAuth = parseToml(firstConfig).model_providers['litellm-gateway-sso'].auth
    const helperPath = join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs')
    expect(firstAuth.command).toBe(helperPath)
    expect(existsSync(helperPath)).toBe(true)
    expect(firstConfig).not.toContain(VALUE.ApiKey)

    const reinstall = await runCliProgram([...args, '--non-interactive'], boundary)
    expect(reinstall.exitCode).toBe(0)
    expect(readFileSync(configPath, 'utf8')).toBe(firstConfig)
    expect(existsSync(helperPath)).toBe(true)
    expect(loadEnvKey(apiKeyFilePath, VALUE.GatewayOrigin)).toBe(VALUE.ApiKey)
    expect(readFileSync(nativeTokenPath, 'utf8')).toBe(NATIVE_METADATA)
  })

  test('does not plan a credential write for native SSO or ambient environment keys', () => {
    const context = createInstallApiKeyContext({ HOME: homeDirectory })
    expect(planInstallApiKeyAsset(preparedInstall({ auth: InstallAuth.Sso }), context)).toBeUndefined()
    expect(planInstallApiKeyAsset(preparedInstall({ auth: InstallAuth.Environment }), context)).toBeUndefined()
    expect(existsSync(context.path)).toBe(false)
    expect(readFileSync(nativeTokenPath, 'utf8')).toBe(NATIVE_METADATA)
  })
})
