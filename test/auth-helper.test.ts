import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { installCodexAuthHelper, renderCodexAuthHelperSource } from '../src/cli/auth-helper'
import { resolveManualLiteLLMApiKeyPath } from '../src/cli/official-token'

const ORIGIN = 'https://gateway.example.test'
const KEY = 'sk-gateway-test-key'
let homeDirectory: string
let apiKeyFilePath: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'codex-auth-helper-'))
  apiKeyFilePath = resolveManualLiteLLMApiKeyPath({ XDG_CONFIG_HOME: join(homeDirectory, 'custom-config') })
})
afterEach(() => { rmSync(homeDirectory, { recursive: true, force: true }) })

describe('Codex manual API-key helper', () => {
  test('reads only the dedicated configured store despite competing native and environment keys', () => {
    const path = installHelper()
    writeKey({ base_url: ORIGIN, key: KEY })
    writeNativeToken({ base_url: ORIGIN, key: 'sk-native-test-only' })
    const result = runHelper(path)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${KEY}\n`)
    expect(result.stderr).toBe('')
  })

  test.each([
    { base_url: ORIGIN },
    { base_url: 'https://other.example.test', key: KEY },
    { base_url: `${ORIGIN}/`, key: KEY },
    { base_url: ORIGIN, key: `${KEY}\n` },
    { base_url: ORIGIN, key: '' },
  ])('rejects an unusable manual record without exposing the key', (record) => {
    const path = installHelper()
    writeKey(record)
    const result = runHelper(path)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(KEY)
  })

  test('requires explicit manual reentry instead of reading legacy native token.json', () => {
    const path = installHelper()
    writeNativeToken({ base_url: ORIGIN, key: KEY, user_role: 'cli' })
    const result = runHelper(path)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('install')
    expect(result.stderr).not.toContain(KEY)
  })

  test('rejects retired launchctl arguments before reading a key', () => {
    const path = installHelper()
    writeKey({ base_url: ORIGIN, key: KEY })
    const result = runHelper(path, ['--launchctl-setenv', 'LITELLM_PROXY_API_KEY'])
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unsupported')
  })

  test('normalizes the configured origin and installs byte-identical private helpers', () => {
    const options = { homeDirectory, gatewayOrigin: `${ORIGIN}/v1///`, apiKeyFilePath }
    const first = installCodexAuthHelper(options)
    const bytes = readFileSync(first.destination)
    const second = installCodexAuthHelper(options)
    expect(second.status).toBe('unchanged')
    expect(readFileSync(first.destination)).toEqual(bytes)
    expect(readdirSync(join(homeDirectory, '.codex', 'libexec'))).toEqual(['litellm-auth-token.mjs'])
    expect(renderCodexAuthHelperSource(`${ORIGIN}/v1///`, apiKeyFilePath)).not.toContain('/v1///')
    expect(bytes.toString()).not.toContain(KEY)
    if (process.platform !== 'win32') {
      expect(statSync(first.destination).mode & 0o777).toBe(0o700)
      chmodSync(first.destination, 0o600)
      installCodexAuthHelper(options)
      expect(statSync(first.destination).mode & 0o777).toBe(0o700)
    }
  })
})

function installHelper(): string {
  return installCodexAuthHelper({ homeDirectory, gatewayOrigin: ORIGIN, apiKeyFilePath }).destination
}
function writeKey(record: Readonly<Record<string, unknown>>): void {
  mkdirSync(dirname(apiKeyFilePath), { recursive: true })
  writeFileSync(apiKeyFilePath, JSON.stringify(record))
}
function writeNativeToken(record: Readonly<Record<string, unknown>>): void {
  mkdirSync(join(homeDirectory, '.litellm'), { recursive: true })
  writeFileSync(join(homeDirectory, '.litellm', 'token.json'), JSON.stringify(record))
}
function runHelper(path: string, args: readonly string[] = []) {
  return spawnSync('node', [path, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDirectory, XDG_CONFIG_HOME: join(homeDirectory, 'different-config'), LITELLM_PROXY_API_KEY: 'sk-stale-test-only' },
  })
}
