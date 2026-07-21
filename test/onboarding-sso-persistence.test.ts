import { afterEach, describe, expect, test } from 'bun:test'
import { SsoTokenPersistence, onboardLiteLLMSso } from '../src/cli/onboarding-sso'
import {
  PLATFORM,
  SECRET,
  START,
  URL,
  cleanupSsoFixtures,
  createFixture,
  existsSync,
  jsonResponse,
  join,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from './onboarding-sso-test-support'

describe('LiteLLM built-in SSO onboarding', () => {
  test('returns a deferred credential without persisting the token destination', async () => {
    // Given: install-scoped SSO requests deferred token persistence
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ])

    // When: authentication completes with the defer policy
    const result = await onboardLiteLLMSso({
      ...fixture.input,
      tokenPersistence: SsoTokenPersistence.Defer,
    })

    // Then: the credential is returned in memory and no token file is exposed
    expect(result.token).toMatchObject({ base_url: URL.Base, key: SECRET.Key })
    expect(existsSync(fixture.tokenPath)).toBe(false)
  })

  test('opens the server verification URL and atomically persists only the official token schema', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse({ ...START, verification_uri_complete: URL.Verification }),
      jsonResponse({ status: 'ready', key: SECRET.Key, user_id: 'user@example.test' }),
    ])
    mkdirSync(join(fixture.home, '.litellm'))
    writeFileSync(fixture.tokenPath, '{"stale":true}', { mode: 0o644 })

    // When
    const result = await onboardLiteLLMSso(fixture.input)

    // Then
    expect(result).toEqual({ status: 'authenticated' })
    expect(fixture.verifications).toEqual([{ url: URL.Verification, userCode: START.user_code }])
    expect(JSON.parse(readFileSync(fixture.tokenPath, 'utf8'))).toEqual({
      base_url: URL.Base,
      key: SECRET.Key,
      user_id: 'user@example.test',
      user_email: 'unknown',
      user_role: 'cli',
      auth_header_name: 'Authorization',
      jwt_token: '',
      timestamp: 1234.5,
    })
    expect(readdirSync(join(fixture.home, '.litellm'))).toEqual(['token.json'])
    if (process.platform !== PLATFORM.Windows) expect(statSync(fixture.tokenPath).mode & 0o777).toBe(0o600)
  })
})

afterEach(cleanupSsoFixtures)
