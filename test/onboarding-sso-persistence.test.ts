import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SsoOnboardingError, onboardLiteLLMSso } from '../src/cli/onboarding-sso'

const homes: string[] = []
const NATIVE_COMMAND = { Auth: 'auth' } as const
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('official LiteLLM login ownership', () => {
  test('lets native PKCE login own persistence and returns no credential copy', async () => {
    // Given: the native CLI writes metadata while keeping the key in its keychain.
    const home = mkdtempSync(join(tmpdir(), 'native-login-'))
    homes.push(home)
    const tokenFilePath = join(home, '.litellm', 'token.json')
    const metadata = JSON.stringify({ base_url: 'https://gateway.example.test', credential_storage: 'keyring', timestamp: 1234 })
    // When: the wrapper delegates login to lite using the real terminal.
    const result = await onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test/', tokenFilePath, boundaries: {
      spawn: (file, args, options) => {
        expect(file).toBe('lite')
        if (args[2] === NATIVE_COMMAND.Auth) {
          expect(args).toEqual(['--base-url', 'https://gateway.example.test', 'auth', 'print-token'])
          return { status: 0, stdout: 'sk-native-login-test-key\n', stderr: '' }
        }
        expect(args).toEqual(['--base-url', 'https://gateway.example.test', '--api-key', '', 'login', '--pkce'])
        expect(options.stdio).toBe('inherit')
        expect(options.env.HOME).toBe(home)
        mkdirSync(join(home, '.litellm'))
        writeFileSync(tokenFilePath, metadata)
        return { status: 0, stdout: null, stderr: null }
      },
    } })
    // Then: native state survives unchanged and no duplicate token is staged.
    expect(result).toEqual({ status: 'authenticated' })
    expect(readFileSync(tokenFilePath, 'utf8')).toBe(metadata)
  })

  test('does not claim login success when native lite exits zero without credentials', async () => {
    // Given: native lite may return zero after a cancelled or interrupted login.
    const home = mkdtempSync(join(tmpdir(), 'native-login-'))
    homes.push(home)
    const tokenFilePath = join(home, '.litellm', 'token.json')
    // When: native login returns without writing a usable credential.
    const result = onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath, boundaries: {
      spawn: () => ({ status: 0, stdout: null, stderr: null }),
    } })
    // Then: the wrapper neither reports authentication nor invents its own token file.
    await expect(result).rejects.toBeInstanceOf(SsoOnboardingError)
    expect(existsSync(tokenFilePath)).toBe(false)
  })

  test('rejects native login exit zero when an earlier credential remains usable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'native-login-'))
    homes.push(home)
    const tokenFilePath = join(home, '.litellm', 'token.json')
    const previous = JSON.stringify({ base_url: 'https://gateway.example.test', key: 'sk-old-test-only', timestamp: 1234 })
    mkdirSync(join(home, '.litellm'))
    writeFileSync(tokenFilePath, previous)
    let tokenCalls = 0
    const result = onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath, boundaries: {
      spawn: (_file, args) => {
        if (args.at(-1) === 'print-token') tokenCalls += 1
        return { status: 0, stdout: 'sk-old-test-only\n', stderr: '' }
      },
    } })
    await expect(result).rejects.toBeInstanceOf(SsoOnboardingError)
    expect(tokenCalls).toBe(0)
    expect(readFileSync(tokenFilePath, 'utf8')).toBe(previous)
  })

  test.each([undefined, null, '1235', Number.NaN, Number.POSITIVE_INFINITY, 1233, 1234])(
    'requires a newer finite native login timestamp before reading a token (%s)', async (timestamp) => {
      const home = mkdtempSync(join(tmpdir(), 'native-login-'))
      homes.push(home)
      const tokenFilePath = join(home, '.litellm', 'token.json')
      mkdirSync(join(home, '.litellm'))
      writeFileSync(tokenFilePath, JSON.stringify({ base_url: 'https://gateway.example.test', timestamp: 1234 }))
      let tokenCalls = 0
      const result = onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath, boundaries: {
        spawn: (_file, args) => {
          if (args.at(-1) === 'print-token') tokenCalls += 1
          else writeFileSync(tokenFilePath, JSON.stringify({ base_url: 'https://gateway.example.test', timestamp, key: 'sk-old-test-only' }))
          return { status: 0, stdout: 'sk-old-test-only\n', stderr: '' }
        },
      } })
      await expect(result).rejects.toBeInstanceOf(SsoOnboardingError)
      expect(tokenCalls).toBe(0)
    },
  )

  test('accepts a newly saved native login after a previous credential', async () => {
    const home = mkdtempSync(join(tmpdir(), 'native-login-'))
    homes.push(home)
    const tokenFilePath = join(home, '.litellm', 'token.json')
    mkdirSync(join(home, '.litellm'))
    writeFileSync(tokenFilePath, JSON.stringify({ base_url: 'https://gateway.example.test', timestamp: 1234 }))
    const result = await onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath, boundaries: {
      spawn: (_file, args) => {
        if (args.at(-1) !== 'print-token') {
          writeFileSync(tokenFilePath, JSON.stringify({ base_url: 'https://gateway.example.test', timestamp: 1235 }))
        }
        return { status: 0, stdout: 'sk-new-test-only\n', stderr: '' }
      },
    } })
    expect(result).toEqual({ status: 'authenticated' })
  })
})
