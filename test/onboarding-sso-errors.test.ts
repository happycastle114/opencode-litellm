import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SsoOnboardingError, onboardLiteLLMSso } from '../src/cli/onboarding-sso'

const TOKEN_PATH = join(tmpdir(), 'native-login-test', '.litellm', 'token.json')

describe('official LiteLLM login errors', () => {
  test('returns a sanitized error when native authentication fails', async () => {
    // Given: the native process fails with sensitive server details.
    const secret = 'never-expose-child-diagnostic'
    // When: login is delegated.
    const result = onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath: TOKEN_PATH, boundaries: {
      spawn: () => ({ status: 1, stdout: secret, stderr: secret }),
    } })
    // Then: login fails without leaking child output.
    await expect(result).rejects.toBeInstanceOf(SsoOnboardingError)
    await expect(result).rejects.not.toThrow(secret)
  })

  test('provides the official installation command when lite is missing', async () => {
    // Given: no native executable is available.
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    // When: a native login is requested.
    const result = onboardLiteLLMSso({ baseUrl: 'https://gateway.example.test', tokenFilePath: TOKEN_PATH, boundaries: {
      spawn: () => ({ status: null, stdout: null, stderr: null, error }),
    } })
    // Then: the user gets an actionable prerequisite rather than custom SSO fallback.
    await expect(result).rejects.toThrow("uv tool install 'litellm[cli]'")
  })
})
