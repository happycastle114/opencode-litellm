import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuthInspectionStatus,
  AuthLogoutStatus,
  inspectLiteLLMAuth,
  logoutLiteLLMAuth,
} from '../src/cli/auth-lifecycle'

const VALUE = {
  baseUrl: 'https://llm.example.test',
  otherBaseUrl: 'https://other.example.test',
  key: 'sk-never-returned',
  jwt: 'jwt-never-returned',
} as const

let directory: string
let tokenFilePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'litellm-auth-lifecycle-'))
  tokenFilePath = join(directory, 'token.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('LiteLLM auth lifecycle inspection', () => {
  test('returns only safe metadata for a matching official token', () => {
    writeFileSync(tokenFilePath, JSON.stringify({
      base_url: VALUE.baseUrl,
      key: VALUE.key,
      jwt_token: VALUE.jwt,
      user_id: 'user-123',
      user_email: 'user@example.test',
      user_role: 'member',
      timestamp: 1234.5,
    }))

    const result = inspectLiteLLMAuth({ baseUrl: `${VALUE.baseUrl}///`, tokenFilePath })

    expect(result).toEqual({
      status: AuthInspectionStatus.Authenticated,
      tokenPresent: true,
      baseUrl: VALUE.baseUrl,
      userId: 'user-123',
      userEmail: 'user@example.test',
      userRole: 'member',
      timestamp: 1234.5,
    })
    expect(JSON.stringify(result)).not.toContain(VALUE.key)
    expect(JSON.stringify(result)).not.toContain(VALUE.jwt)
  })

  test('reports missing, malformed, and mismatched tokens without throwing', () => {
    expect(inspectLiteLLMAuth({ baseUrl: VALUE.baseUrl, tokenFilePath })).toEqual({
      status: AuthInspectionStatus.Missing,
      tokenPresent: false,
    })

    writeFileSync(tokenFilePath, '{"base_url":')
    expect(inspectLiteLLMAuth({ baseUrl: VALUE.baseUrl, tokenFilePath })).toEqual({
      status: AuthInspectionStatus.Malformed,
      tokenPresent: false,
    })

    writeFileSync(tokenFilePath, JSON.stringify({ base_url: VALUE.otherBaseUrl, key: VALUE.key }))
    expect(inspectLiteLLMAuth({ baseUrl: VALUE.baseUrl, tokenFilePath })).toEqual({
      status: AuthInspectionStatus.Mismatch,
      tokenPresent: true,
      baseUrl: VALUE.otherBaseUrl,
    })
  })

  test('does not normalize the stored origin', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: `${VALUE.baseUrl}/`, key: VALUE.key }))

    const result = inspectLiteLLMAuth({ baseUrl: VALUE.baseUrl, tokenFilePath })

    expect(result.status).toBe(AuthInspectionStatus.Mismatch)
  })
})

describe('LiteLLM auth logout', () => {
  test('deletes only the exact token file and is idempotent when absent', () => {
    const siblingPath = join(directory, 'token.json.bak')
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: VALUE.baseUrl, key: VALUE.key }))
    writeFileSync(siblingPath, 'keep')

    expect(logoutLiteLLMAuth({ tokenFilePath })).toEqual({ status: AuthLogoutStatus.Removed })
    expect(existsSync(tokenFilePath)).toBe(false)
    expect(readFileSync(siblingPath, 'utf8')).toBe('keep')
    expect(logoutLiteLLMAuth({ tokenFilePath })).toEqual({ status: AuthLogoutStatus.Absent })
  })
})
