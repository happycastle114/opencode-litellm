import { afterEach, describe, expect, test } from 'bun:test'
import { SsoOnboardingError, onboardLiteLLMSso } from '../src/cli/onboarding-sso'
import {
  SECRET,
  START,
  URL,
  captureFailure,
  cleanupSsoFixtures,
  createFixture,
  existsSync,
  jsonResponse,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from './onboarding-sso-test-support'

describe('LiteLLM built-in SSO onboarding', () => {
  test('fails immediately on permanent HTTP errors without exposing response or credential details', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      new Response(JSON.stringify({ detail: SECRET.ServerDetail }), { status: 403 }),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ])

    // When
    const failure = captureFailure(onboardLiteLLMSso(fixture.input))

    // Then
    expect(await failure).toMatchObject({ code: 'poll_http_permanent', status: 403 })
    expect(fixture.requests).toHaveLength(2)
    expect(String(await failure)).not.toContain(SECRET.ServerDetail)
    expect(String(await failure)).not.toContain(SECRET.Poll)
  })

  test.each([
    ['CR', '\r'],
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ] as const)('rejects a poll API key containing %s without writing a token', async (_label, lineBreak) => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', key: `${SECRET.Key}${lineBreak}suffix` }),
    ])
    mkdirSync(`${fixture.home}/.litellm`)
    writeFileSync(fixture.tokenPath, '{"stale":true}')

    // When
    const failure = captureFailure(onboardLiteLLMSso(fixture.input))

    // Then
    await expect(failure).resolves.toMatchObject({ code: 'invalid_poll_response' })
    expect(readFileSync(fixture.tokenPath, 'utf8')).toBe('{"stale":true}')
    expect(readdirSync(`${fixture.home}/.litellm`)).toEqual(['token.json'])
  })

  test.each([
    ['malformed start response', jsonResponse({ ...START, poll_secret: 42 })],
    ['cross-origin verification URL', jsonResponse({ ...START, verification_uri_complete: URL.Other })],
  ] as const)('rejects %s before polling without leaking start values', async (_label, start) => {
    // Given
    const fixture = createFixture([start, jsonResponse({ status: 'ready', key: SECRET.Key })])

    // When
    const failure = captureFailure(onboardLiteLLMSso(fixture.input))

    // Then
    expect(await failure).toBeInstanceOf(SsoOnboardingError)
    expect(fixture.requests).toHaveLength(1)
    expect(String(await failure)).not.toContain(SECRET.Poll)
    expect(existsSync(fixture.tokenPath)).toBe(false)
  })

  test('rejects a team id that was not offered without re-polling', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', requires_team_selection: true, teams: ['team-a'] }),
    ], URL.Base, async () => 'team-attacker')

    // When
    const failure = captureFailure(onboardLiteLLMSso(fixture.input))

    // Then
    expect(await failure).toMatchObject({ code: 'invalid_team_selection' })
    expect(fixture.requests).toHaveLength(2)
  })
})

afterEach(cleanupSsoFixtures)
