import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuthInspectionStatus,
  AuthLogoutStatus,
  LiteLLMAuthLifecycleError,
  inspectLiteLLMAuth,
  logoutLiteLLMAuth,
} from '../src/cli/auth-lifecycle'
import { resolveManualLiteLLMApiKeyPath } from '../src/cli/official-token'

const ORIGIN = 'https://gateway.example.test'
const KEY = 'sk-private-test-credential'
const LOGOUT_SUCCESS = 'Logged out successfully. Authentication token cleared.\n'
let directory: string
let tokenFilePath: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'litellm-auth-lifecycle-'))
  mkdirSync(join(directory, '.litellm'))
  tokenFilePath = join(directory, '.litellm', 'token.json')
})
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('native LiteLLM lifecycle', () => {
  test('reports safe metadata after native file credential resolution', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN, key: KEY, user_id: 'test-user', user_role: 'cli', timestamp: 1234 }))
    // When: native lite resolves the credential.
    const result = inspectLiteLLMAuth({ baseUrl: `${ORIGIN}/`, tokenFilePath, native: {
      spawn: () => ({ status: 0, stdout: `${KEY}\n`, stderr: '' }),
    } })
    // Then: the response is authenticated without exposing the credential.
    expect(result).toEqual({ status: AuthInspectionStatus.Authenticated, tokenPresent: true, baseUrl: ORIGIN, userId: 'test-user', userRole: 'cli', timestamp: 1234 })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  test('does not report expired or unreadable native credentials as authenticated', () => {
    // Given: old metadata still exists but native renewal fails.
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN, key: KEY }))
    // When: authentication is inspected.
    const result = inspectLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: () => ({ status: 1, stdout: '', stderr: KEY }),
    } })
    // Then: neither the stale key nor a success status escapes.
    expect(result.status).toBe(AuthInspectionStatus.Missing)
    expect(result.tokenPresent).toBe(false)
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  test.each(['https://other.example.test', `${ORIGIN}/`])('rejects mismatched logout without touching the native credential', (storedOrigin) => {
    // Given: a login belongs to another exact origin.
    const contents = JSON.stringify({ base_url: storedOrigin, key: KEY })
    writeFileSync(tokenFilePath, contents)
    let calls = 0
    // When and Then: an unrelated logout fails before the native command.
    expect(() => logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: () => { calls += 1; return { status: 0, stdout: LOGOUT_SUCCESS, stderr: '' } },
    } })).toThrow(LiteLLMAuthLifecycleError)
    expect(calls).toBe(0)
    expect(readFileSync(tokenFilePath, 'utf8')).toBe(contents)
  })

  test('delegates matching logout to lite and preserves the separate manual credential', () => {
    // Given: both independent authentication stores contain credentials.
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN }))
    const manualPath = resolveManualLiteLLMApiKeyPath({ HOME: directory })
    const manualSource = JSON.stringify({ base_url: ORIGIN, key: KEY })
    mkdirSync(join(manualPath, '..'), { recursive: true })
    writeFileSync(manualPath, manualSource)
    // When: native logout clears its own credential and confirms completion.
    const result = logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: (_file, args) => {
        expect(args).toEqual(['--base-url', ORIGIN, 'logout'])
        unlinkSync(tokenFilePath)
        return { status: 0, stdout: LOGOUT_SUCCESS, stderr: '' }
      },
    } })
    // Then: the wrapper reports native completion without implementing token deletion.
    expect(result.status).toBe(AuthLogoutStatus.Removed)
    expect(existsSync(tokenFilePath)).toBe(false)
    expect(readFileSync(manualPath, 'utf8')).toBe(manualSource)
    expect(() => logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath })).toThrow(/unverified/)
  })

  test('fails closed when native logout warns that the keychain entry remains', () => {
    // Given: upstream lite can print a warning while exiting with status zero.
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN }))
    // When and Then: a warning cannot be reported as a complete logout.
    expect(() => logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: () => {
        unlinkSync(tokenFilePath)
        return { status: 0, stdout: 'Your credential is still in your OS keychain.', stderr: '' }
      },
    } })).toThrow(LiteLLMAuthLifecycleError)
    let retryCalls = 0
    expect(() => logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: () => { retryCalls += 1; return { status: 0, stdout: LOGOUT_SUCCESS, stderr: '' } },
    } })).toThrow(/unverified/)
    expect(retryCalls).toBe(0)
  })

  test('accepts native file logout when keyring access is explicitly disabled', () => {
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN, key: KEY }))
    const result = logoutLiteLLMAuth({ baseUrl: ORIGIN, tokenFilePath, native: {
      spawn: (_file, _args, options) => {
        expect(options.env.LITELLM_CLI_DISABLE_KEYRING).toBe('1')
        writeFileSync(tokenFilePath, JSON.stringify({ base_url: ORIGIN }))
        return { status: 0, stderr: '', stdout: 'Logged out locally, but your OS keychain could not be checked, so a credential stored there by an earlier login may still be usable.\nUnset LITELLM_CLI_DISABLE_KEYRING and run \'lite logout\' again to clear it.\n' }
      },
    } })
    expect(result.status).toBe(AuthLogoutStatus.Removed)
    expect(readFileSync(tokenFilePath, 'utf8')).not.toContain(KEY)
  })
})
