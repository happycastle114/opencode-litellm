import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadEnvKey, loadOfficialLiteLLMApiKey, resolveManualLiteLLMApiKeyPath } from '../src/cli/official-token'
import type { NativeLiteBoundary } from '../src/cli/native-lite'

const ORIGIN = 'https://gateway.example.test'
const KEY = 'sk-native-gateway-test'
let directory: string
let tokenFilePath: string
let manualKeyPath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opencode-litellm-token-'))
  mkdirSync(join(directory, '.litellm'))
  tokenFilePath = join(directory, '.litellm', 'token.json')
  manualKeyPath = resolveManualLiteLLMApiKeyPath({ HOME: directory })
  mkdirSync(dirname(manualKeyPath), { recursive: true })
})
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('official LiteLLM credential resolution', () => {
  test('uses the official CLI for a credential kept in the OS keychain', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN }))
    writeFileSync(manualKeyPath, JSON.stringify({ base_url: ORIGIN, key: 'sk-separate-manual-key' }))
    const calls: { file: string; args: readonly string[] }[] = []
    const native: NativeLiteBoundary = {
      spawn: (file, args) => {
        calls.push({ file, args })
        return { status: 0, stdout: `${KEY}\n`, stderr: '' }
      },
    }
    const key = loadOfficialLiteLLMApiKey({ tokenFilePath, expectedBaseURL: `${ORIGIN}/`, native })
    expect(key).toBe(KEY)
    expect(calls).toEqual([{ file: 'lite', args: ['--base-url', ORIGIN, 'auth', 'print-token'] }])
  })

  test.each([
    undefined,
    '{"base_url":',
    JSON.stringify({ base_url: 'https://other.example.test', key: KEY }),
    JSON.stringify({ base_url: `${ORIGIN}/`, key: KEY }),
    JSON.stringify({ base_url: `${ORIGIN}/v1`, key: KEY }),
  ])('rejects absent, malformed and mismatched records before invoking lite', (contents) => {
    if (contents !== undefined) writeFileSync(tokenFilePath, contents)
    let calls = 0
    const key = loadOfficialLiteLLMApiKey({
      tokenFilePath, expectedBaseURL: ORIGIN,
      native: { spawn: () => { calls += 1; return { status: 0, stdout: KEY, stderr: '' } } },
    })
    expect(key).toBeUndefined()
    expect(calls).toBe(0)
  })

  test('never falls back to a plaintext token or separate manual key when native renewal fails', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN, key: KEY, user_role: 'cli' }))
    writeFileSync(manualKeyPath, JSON.stringify({ base_url: ORIGIN, key: 'sk-separate-manual-key' }))
    const key = loadOfficialLiteLLMApiKey({ tokenFilePath, expectedBaseURL: ORIGIN, native: {
      spawn: () => ({ status: 1, stdout: KEY, stderr: KEY }),
    } })
    expect(key).toBeUndefined()
  })
})

describe('dedicated manual API key storage', () => {
  test('uses XDG_CONFIG_HOME and otherwise the home config directory', () => {
    expect(resolveManualLiteLLMApiKeyPath({ HOME: directory })).toBe(join(directory, '.config', 'opencode-litellm', 'api-key.json'))
    expect(resolveManualLiteLLMApiKeyPath({ XDG_CONFIG_HOME: join(directory, 'xdg') })).toBe(join(directory, 'xdg', 'opencode-litellm', 'api-key.json'))
    expect(resolveManualLiteLLMApiKeyPath({ HOME: directory, XDG_CONFIG_HOME: '' })).toBe(manualKeyPath)
    expect(() => resolveManualLiteLLMApiKeyPath({})).toThrow(/HOME|XDG_CONFIG_HOME/)
  })

  test('loads an exact-origin key independently of native metadata', () => {
    writeFileSync(manualKeyPath, JSON.stringify({ base_url: ORIGIN, key: KEY }))
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: 'https://native.example.test' }))
    expect(loadEnvKey(manualKeyPath, `${ORIGIN}/`)).toBe(KEY)
    expect(loadEnvKey(manualKeyPath, `${ORIGIN}/v1`)).toBeUndefined()
  })

  test('does not migrate or reuse a legacy key in the official token file', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN, key: KEY, user_role: 'cli' }))
    expect(loadEnvKey(manualKeyPath, ORIGIN)).toBeUndefined()
  })

  test.each([
    { base_url: ORIGIN, key: `${KEY}\n` },
    { base_url: ORIGIN, jwt_token: KEY },
    { base_url: ORIGIN, key: '' },
    { base_url: 'https://other.example.test', key: KEY },
    { base_url: `${ORIGIN}/`, key: KEY },
  ])('rejects malformed and mismatched manual records', (record) => {
    writeFileSync(manualKeyPath, JSON.stringify(record))
    expect(loadEnvKey(manualKeyPath, ORIGIN)).toBeUndefined()
  })
})
