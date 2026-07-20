import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOfficialLiteLLMApiKey } from '../src/cli/official-token'

const URL = {
  gatewayOrigin: 'https://llm.example.test',
  crossOrigin: 'https://attacker.example.test',
} as const
const TOKEN = {
  gatewayKey: 'sk-official-gateway-key',
  jwtDecoy: 'jwt-must-never-be-returned',
} as const
const MALFORMED_JSON = '{"base_url":' as const

let directory: string
let tokenFilePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opencode-litellm-token-'))
  tokenFilePath = join(directory, 'token.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('official LiteLLM token.json loader', () => {
  test('returns key when the stored base_url matches the trailing-slash-normalized origin', () => {
    // Given: the official CLI token shape for the target gateway
    writeFileSync(tokenFilePath, JSON.stringify({
      base_url: URL.gatewayOrigin,
      key: TOKEN.gatewayKey,
      jwt_token: TOKEN.jwtDecoy,
    }))

    // When: the caller supplies the same credential origin with a trailing slash
    const key = loadOfficialLiteLLMApiKey({
      tokenFilePath,
      expectedBaseURL: `${URL.gatewayOrigin}/`,
    })

    // Then: only the official key field is returned
    expect(key).toBe(TOKEN.gatewayKey)
    expect(key).not.toBe(TOKEN.jwtDecoy)
  })

  test.each([
    ['malformed JSON', MALFORMED_JSON],
    ['missing key', JSON.stringify({ base_url: URL.gatewayOrigin })],
    ['missing base_url', JSON.stringify({ key: TOKEN.gatewayKey })],
    ['cross-origin token', JSON.stringify({ base_url: URL.crossOrigin, key: TOKEN.gatewayKey })],
    ['API-path token', JSON.stringify({ base_url: `${URL.gatewayOrigin}/v1`, key: TOKEN.gatewayKey })],
    ['jwt_token without key', JSON.stringify({ base_url: URL.gatewayOrigin, jwt_token: TOKEN.jwtDecoy })],
  ] as const)('rejects %s', (_label, contents) => {
    // Given: an unusable or origin-mismatched official token file
    writeFileSync(tokenFilePath, contents)

    // When: the gateway credential is resolved
    const key = loadOfficialLiteLLMApiKey({
      tokenFilePath,
      expectedBaseURL: URL.gatewayOrigin,
    })

    // Then: no credential is returned
    expect(key).toBeUndefined()
  })

  test('returns undefined when token.json is missing', () => {
    // Given: no official LiteLLM token file
    // When: the gateway credential is resolved
    const key = loadOfficialLiteLLMApiKey({
      tokenFilePath,
      expectedBaseURL: URL.gatewayOrigin,
    })

    // Then: the loader fails closed
    expect(key).toBeUndefined()
  })
})
