import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installCodexAuthHelper,
  resolveCodexAuthHelperPath,
  renderCodexAuthHelperSource,
} from '../src/cli/auth-helper'

const URL = {
  Gateway: 'https://llm.example.test',
  GatewayWithSlash: 'https://llm.example.test/v1///',
  Other: 'https://other.example.test',
} as const

const TOKEN = {
  Key: 'sk-gateway-key',
  Jwt: 'jwt-secret-decoy',
} as const

const ENV = {
  Valid: 'LITELLM_PROXY_API_KEY',
  Invalid: '9NOT_AN_ENV_NAME',
} as const

let homeDirectory: string

describe('Codex command-backed auth helper', () => {
  test('prints only the matching key and never the jwt_token', () => {
    const helperPath = installHelper()
    writeToken({
      base_url: URL.Gateway,
      key: TOKEN.Key,
      jwt_token: TOKEN.Jwt,
    })

    const result = runHelper(helperPath)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${TOKEN.Key}\n`)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain(TOKEN.Jwt)
  })

  test.each([
    ['missing token', undefined],
    ['malformed token', '{"base_url":'],
    ['mismatched base_url', JSON.stringify({ base_url: URL.Other, key: TOKEN.Key })],
    ['stored trailing slash', JSON.stringify({ base_url: `${URL.Gateway}/`, key: TOKEN.Key })],
    ['missing key', JSON.stringify({ base_url: URL.Gateway })],
    ['empty key', JSON.stringify({ base_url: URL.Gateway, key: '' })],
    ['jwt_token without key', JSON.stringify({ base_url: URL.Gateway, jwt_token: TOKEN.Jwt })],
  ] as const)('fails closed for %s without leaking secrets', (_label, contents) => {
    const helperPath = installHelper()
    if (contents !== undefined) writeTokenFile(contents)

    const result = runHelper(helperPath)

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(TOKEN.Key)
    expect(result.stderr).not.toContain(TOKEN.Jwt)
  })

  test('normalizes the gateway origin at install time while comparing stored base_url exactly', () => {
    const source = renderCodexAuthHelperSource(URL.GatewayWithSlash)

    expect(source).toContain(JSON.stringify(URL.Gateway))
    expect(source).not.toContain('/v1///')
    expect(source).not.toContain(TOKEN.Key)
    expect(source).not.toContain(TOKEN.Jwt)

    const helperPath = installHelper(URL.GatewayWithSlash)
    writeToken({ base_url: URL.Gateway, key: TOKEN.Key })
    expect(runHelper(helperPath).status).toBe(0)
  })

  test('is byte-idempotent and sets 0700 on POSIX', () => {
    const first = installCodexAuthHelper({ homeDirectory, gatewayOrigin: URL.Gateway, now: () => new Date(0) })
    const path = resolveCodexAuthHelperPath(homeDirectory)
    const firstBytes = readFileSync(path)
    const second = installCodexAuthHelper({ homeDirectory, gatewayOrigin: URL.Gateway, now: () => new Date(0) })

    expect(first.destination).toBe(path)
    expect(second.destination).toBe(path)
    expect(second.status).toBe('unchanged')
    expect(readFileSync(path)).toEqual(firstBytes)
    expect(readdirSync(join(homeDirectory, '.codex', 'libexec'))).toEqual([
      'litellm-auth-token.mjs',
    ])
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o700)
      chmodSync(path, 0o600)
      installCodexAuthHelper({ homeDirectory, gatewayOrigin: URL.Gateway, now: () => new Date(0) })
      expect(statSync(path).mode & 0o777).toBe(0o700)
    }
    expect(first.status).toBe('installed')
  })

  test('rejects invalid launchctl environment names without exposing the key', () => {
    const helperPath = installHelper()
    writeToken({ base_url: URL.Gateway, key: TOKEN.Key })

    const result = runHelper(helperPath, ['--launchctl-setenv', ENV.Invalid])

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(TOKEN.Key)
  })

  test('rejects launchctl mode off macOS without exposing the key', () => {
    const helperPath = installHelper()
    writeToken({ base_url: URL.Gateway, key: TOKEN.Key })

    const result = runHelper(helperPath, ['--launchctl-setenv', ENV.Valid])

    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(TOKEN.Key)
    if (process.platform !== 'darwin') {
      expect(result.status).not.toBe(0)
    }
  })
})

function installHelper(gatewayOrigin: string = URL.Gateway): string {
  return installCodexAuthHelper({ homeDirectory, gatewayOrigin, now: () => new Date(0) }).destination
}

function writeToken(token: Record<string, unknown>): void {
  writeTokenFile(JSON.stringify(token))
}

function writeTokenFile(contents: string): void {
  const tokenDirectory = join(homeDirectory, '.litellm')
  const tokenPath = join(tokenDirectory, 'token.json')
  mkdirSync(tokenDirectory, { recursive: true })
  writeFileSync(tokenPath, contents)
}

function runHelper(path: string, args: readonly string[] = []) {
  return spawnSync(process.execPath, [path, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDirectory },
  })
}

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'codex-auth-helper-'))
})

afterEach(() => {
  if (existsSync(homeDirectory)) rmSync(homeDirectory, { recursive: true, force: true })
})
