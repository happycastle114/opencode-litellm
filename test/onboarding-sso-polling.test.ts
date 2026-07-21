import { afterEach, describe, expect, test } from 'bun:test'
import { onboardLiteLLMSso } from '../src/cli/onboarding-sso'
import {
  SECRET,
  START,
  URL,
  captureFailure,
  cleanupSsoFixtures,
  createFixture,
  existsSync,
  jsonResponse,
  readFileSync,
} from './onboarding-sso-test-support'

describe('LiteLLM built-in SSO onboarding', () => {
  test('constructs the official fallback verification URL and strips only trailing slashes from the base URL', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ], `${URL.Base}///`)

    // When
    await onboardLiteLLMSso(fixture.input)

    // Then
    expect(fixture.verifications[0]?.url).toBe(
      `${URL.Base}/sso/key/generate?source=litellm-cli&key=${START.login_id}`,
    )
    expect(JSON.parse(readFileSync(fixture.tokenPath, 'utf8')).base_url).toBe(URL.Base)
  })

  test('sends the polling secret only in the required header and retries pending responses', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'pending' }),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ])

    // When
    await onboardLiteLLMSso(fixture.input)

    // Then
    expect(fixture.requests.slice(1).map((request) => request.headers)).toEqual([
      { 'x-litellm-cli-poll-secret': SECRET.Poll },
      { 'x-litellm-cli-poll-secret': SECRET.Poll },
    ])
    expect(fixture.sleeps).toEqual([10])
    expect(fixture.requests.map((request) => request.url).join('\n')).not.toContain(SECRET.Poll)
  })

  test('normalizes team_details, selects a team, and re-polls with an encoded team_id', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({
        status: 'ready',
        requires_team_selection: true,
        team_details: [
          { team_id: 'team/alpha', team_alias: 'Alpha' },
          { id: 'team-beta' },
        ],
      }),
      jsonResponse({ status: 'ready', key: SECRET.Key, user_id: 'member@example.test' }),
    ], URL.Base, async (teams) => {
      fixture.selectedTeams.push(teams)
      return 'team/alpha'
    })

    // When
    await onboardLiteLLMSso(fixture.input)

    // Then
    expect(fixture.selectedTeams).toEqual([[
      { teamId: 'team/alpha', teamAlias: 'Alpha' },
      { teamId: 'team-beta' },
    ]])
    expect(fixture.requests[2]?.url).toBe(
      `${URL.Base}/sso/cli/poll/${START.login_id}?team_id=team%2Falpha`,
    )
  })

  test('falls back to the teams list when team_details is absent', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', requires_team_selection: true, teams: ['team-a'] }),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ], URL.Base, async (teams) => {
      fixture.selectedTeams.push(teams)
      return teams[0]?.teamId
    })

    // When
    await onboardLiteLLMSso(fixture.input)

    // Then
    expect(fixture.selectedTeams).toEqual([[{ teamId: 'team-a' }]])
  })

  test('retries 429, server failures, and network failures before succeeding', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      new Response('', { status: 429 }),
      new Response('', { status: 503 }),
      new TypeError('network unavailable'),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ])

    // When
    const result = await onboardLiteLLMSso({ ...fixture.input, totalTimeoutMs: 50 })

    // Then
    expect(result.status).toBe('authenticated')
    expect(fixture.sleeps).toEqual([10, 10, 10])
  })

  test('times out after the configured polling budget without writing a token', async () => {
    // Given
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'pending' }),
      jsonResponse({ status: 'pending' }),
      jsonResponse({ status: 'pending' }),
    ])

    // When
    const failure = captureFailure(onboardLiteLLMSso(fixture.input))

    // Then
    expect(await failure).toMatchObject({ code: 'authentication_timeout' })
    expect(fixture.sleeps).toEqual([10, 10])
    expect(existsSync(fixture.tokenPath)).toBe(false)
  })

  test('shares one polling deadline across team selection and advancing request attempts', async () => {
    // Given
    let nowMs = 0
    let fetchCount = 0
    const fixture = createFixture([
      jsonResponse(START),
      jsonResponse({ status: 'ready', requires_team_selection: true, teams: ['team-a'] }),
      jsonResponse({ status: 'pending' }),
      jsonResponse({ status: 'ready', key: SECRET.Key }),
    ], URL.Base, async () => {
      nowMs += 5
      return 'team-a'
    }, {
      now: () => nowMs,
      onRequest: () => {
        fetchCount += 1
        if (fetchCount > 1) nowMs += 12
      },
    })

    // When
    const failure = captureFailure(onboardLiteLLMSso({
      ...fixture.input,
      totalTimeoutMs: 30,
      pollIntervalMs: 10,
      requestTimeoutMs: 25,
    }))

    // Then
    await expect(failure).resolves.toMatchObject({ code: 'authentication_timeout' })
    expect(fixture.requests).toHaveLength(4)
    expect(fixture.sleeps).toEqual([1])
    expect(existsSync(fixture.tokenPath)).toBe(false)
  })
})

afterEach(cleanupSsoFixtures)
