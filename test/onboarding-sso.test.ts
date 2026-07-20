import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SsoOnboardingError,
  onboardLiteLLMSso,
  type SsoOnboardingBoundaries,
  type SsoTeam,
  type SsoVerification,
} from '../src/cli/onboarding-sso'

const URL = {
  Base: 'https://llm.example.test',
  Other: 'https://attacker.example.test/verify',
  Verification: 'https://llm.example.test/custom/verify?flow=cli',
} as const

const SECRET = {
  Key: 'sk-login-result-secret',
  Poll: 'poll-secret-value',
  ServerDetail: 'server-returned-secret-detail',
} as const

const START = {
  login_id: 'cli-login-id',
  poll_secret: SECRET.Poll,
  user_code: 'ABCD-EFGH',
} as const

const PLATFORM = { Windows: 'win32' } as const

const homes: string[] = []

describe('LiteLLM built-in SSO onboarding', () => {
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

type CapturedRequest = {
  readonly url: string
  readonly method: string | undefined
  readonly headers: Readonly<Record<string, string>>
}

function createFixture(
  outcomes: readonly (Response | Error)[],
  baseUrl = URL.Base,
  selectTeam: (teams: readonly SsoTeam[]) => Promise<string | undefined> = async () => undefined,
) {
  const home = mkdtempSync(join(tmpdir(), 'litellm-sso-'))
  homes.push(home)
  const requests: CapturedRequest[] = []
  const sleeps: number[] = []
  const verifications: SsoVerification[] = []
  const selectedTeams: (readonly SsoTeam[])[] = []
  let index = 0
  const boundaries: SsoOnboardingBoundaries = {
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      })
      const outcome = outcomes[index]
      index += 1
      if (outcome instanceof Error) throw outcome
      if (outcome === undefined) throw new Error('Missing HTTP fixture response.')
      return outcome
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds) },
    open: async (verification) => { verifications.push(verification) },
    selectTeam,
  }
  const tokenPath = join(home, '.litellm', 'token.json')
  return {
    home,
    input: {
      baseUrl,
      tokenFilePath: tokenPath,
      totalTimeoutMs: 30,
      pollIntervalMs: 10,
      requestTimeoutMs: 25,
      now: () => 1_234_500,
      boundaries,
    },
    requests,
    sleeps,
    verifications,
    selectedTeams,
    tokenPath,
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function captureFailure(promise: Promise<unknown>): Promise<SsoOnboardingError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SsoOnboardingError) return error
    throw error
  }
  throw new Error('Expected onboarding to fail.')
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
