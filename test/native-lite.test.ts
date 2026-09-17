import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  NativeLiteCommand,
  NativeLiteError,
  runNativeLite,
  type NativeLiteSpawnOptions,
} from '../src/cli/native-lite'

const ORIGIN = 'https://gateway.example.test'
const TOKEN = 'sk-native-test-credential'
const TOKEN_PATH = join(tmpdir(), 'native-lite-test-home', '.litellm', 'token.json')

describe('official LiteLLM command boundary', () => {
  test('binds token resolution to the exact gateway and excludes ambient credentials', () => {
    // Given: another gateway and student credential are in the parent environment.
    let captured: { file: string; args: readonly string[]; options: NativeLiteSpawnOptions } | undefined
    const environment = { PATH: '/test/path', LITELLM_PROXY_URL: 'https://other.example.test', LITELLM_PROXY_API_KEY: 'sk-stale' }

    // When: the current credential is read through the native CLI.
    const key = runNativeLite({ command: NativeLiteCommand.Token, baseUrl: `${ORIGIN}/`, tokenFilePath: TOKEN_PATH }, {
      environment,
      spawn: (file, args, options) => {
        captured = { file, args, options }
        return { status: 0, stdout: `${TOKEN}\n`, stderr: '' }
      },
    })

    // Then: the CLI receives an exact origin without a competing key or shell.
    expect(key).toBe(TOKEN)
    expect(captured?.file).toBe('lite')
    expect(captured?.args).toEqual(['--base-url', ORIGIN, 'auth', 'print-token'])
    expect(captured?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(captured?.options.env.LITELLM_PROXY_URL).toBeUndefined()
    expect(captured?.options.env.PATH).toBe(environment.PATH)
    expect(captured?.options.stdio).toBe('pipe')
    expect(captured?.options.shell).toBe(false)
    expect(environment.LITELLM_PROXY_API_KEY).toBe('sk-stale')
  })

  test.each(['', `${TOKEN}\nextra`, `${TOKEN}\r`, `${TOKEN}\u0000`])('rejects malformed native token output', (stdout) => {
    // Given: a native process reports success with unusable token output.
    const native = { spawn: () => ({ status: 0, stdout, stderr: '' }) }
    // When and Then: the output cannot become an authorization header.
    expect(() => runNativeLite({ command: NativeLiteCommand.Token, baseUrl: ORIGIN, tokenFilePath: TOKEN_PATH }, native)).toThrow(NativeLiteError)
  })

  test('does not expose child error output or error details', () => {
    // Given: a failed executable includes a credential in every diagnostic field.
    const native = { spawn: () => ({ status: 1, stdout: TOKEN, stderr: TOKEN, error: new Error(TOKEN) }) }
    // When: native token lookup fails.
    let failure: unknown
    try {
      runNativeLite({ command: NativeLiteCommand.Token, baseUrl: ORIGIN, tokenFilePath: TOKEN_PATH }, native)
    } catch (error) { failure = error }
    // Then: callers only receive the sanitized failure.
    expect(failure).toBeInstanceOf(NativeLiteError)
    expect(String(failure)).not.toContain(TOKEN)
  })

  test.each(['https://user:password@example.test', 'https://gateway.example.test?key=secret', 'file:///tmp/token'])('rejects unsafe origin before launching', (baseUrl) => {
    // Given: an origin would contain credentials or use an unsupported scheme.
    let calls = 0
    const native = { spawn: () => { calls += 1; return { status: 0, stdout: TOKEN, stderr: '' } } }
    // When and Then: no native command runs for that origin.
    expect(() => runNativeLite({ command: NativeLiteCommand.Token, baseUrl, tokenFilePath: TOKEN_PATH }, native)).toThrow(NativeLiteError)
    expect(calls).toBe(0)
  })
})
