import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SsoOnboardingError,
  type SsoOnboardingBoundaries,
  type SsoTeam,
  type SsoVerification,
} from '../src/cli/onboarding-sso'

export const URL = {
  Base: 'https://llm.example.test',
  Other: 'https://attacker.example.test/verify',
  Verification: 'https://llm.example.test/custom/verify?flow=cli',
} as const

export const SECRET = {
  Key: 'sk-login-result-secret',
  Poll: 'poll-secret-value',
  ServerDetail: 'server-returned-secret-detail',
} as const

export const START = {
  login_id: 'cli-login-id',
  poll_secret: SECRET.Poll,
  user_code: 'ABCD-EFGH',
} as const

export const PLATFORM = { Windows: 'win32' } as const

type CapturedRequest = {
  readonly url: string
  readonly method: string | undefined
  readonly headers: Readonly<Record<string, string>>
}

type FixtureOptions = {
  readonly now?: () => number
  readonly onRequest?: () => void
}

const homes: string[] = []

export function createFixture(
  outcomes: readonly (Response | Error)[],
  baseUrl = URL.Base,
  selectTeam: (teams: readonly SsoTeam[]) => Promise<string | undefined> = async () => undefined,
  options: FixtureOptions = {},
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
      options.onRequest?.()
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
      now: options.now ?? (() => 1_234_500),
      boundaries,
    },
    requests,
    sleeps,
    verifications,
    selectedTeams,
    tokenPath,
  }
}

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export async function captureFailure(promise: Promise<unknown>): Promise<SsoOnboardingError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SsoOnboardingError) return error
    throw error
  }
  throw new Error('Expected onboarding to fail.')
}

export function cleanupSsoFixtures(): void {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
}

export {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  join,
}
