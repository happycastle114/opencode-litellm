export const ENDPOINT = {
  Start: '/sso/cli/start',
  Poll: '/sso/cli/poll/',
  Verify: '/sso/key/generate',
} as const

export const RESPONSE_STATUS = {
  Pending: 'pending',
  Ready: 'ready',
} as const

export const RESULT_STATUS = {
  Authenticated: 'authenticated',
} as const

export const SsoTokenPersistence = {
  Defer: 'defer',
  Persist: 'persist',
} as const

export const POLL_KIND = {
  Credential: 'credential',
  TeamChoice: 'team-choice',
} as const

export const ERROR_CODE = {
  InvalidBaseUrl: 'invalid_base_url',
  StartRequest: 'start_request_failed',
  StartHttp: 'start_http_failed',
  InvalidStart: 'invalid_start_response',
  CrossOriginVerification: 'cross_origin_verification',
  VerificationOpen: 'verification_open_failed',
  PollHttpPermanent: 'poll_http_permanent',
  InvalidPoll: 'invalid_poll_response',
  AuthenticationTimeout: 'authentication_timeout',
  TeamSelectionRequired: 'team_selection_required',
  InvalidTeamSelection: 'invalid_team_selection',
  TokenWrite: 'token_write_failed',
} as const

export type SsoErrorCode = typeof ERROR_CODE[keyof typeof ERROR_CODE]

export const HTTP = {
  ClientMinimum: 400,
  ClientMaximum: 499,
  RateLimited: 429,
  ServerMinimum: 500,
} as const

export const ALLOWED_PROTOCOLS = new Set<string>(['http:', 'https:'])

export type SsoVerification = {
  readonly url: string
  readonly userCode: string
}

export type SsoTeam = {
  readonly teamId: string
  readonly teamAlias?: string
}

export type SsoOnboardingBoundaries = {
  readonly fetch?: typeof globalThis.fetch
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly open: (verification: SsoVerification) => Promise<void>
  readonly selectTeam: (teams: readonly SsoTeam[]) => Promise<string | undefined>
}

export type SsoOnboardingInput = {
  readonly baseUrl: string
  readonly tokenFilePath?: string
  readonly tokenPersistence?: typeof SsoTokenPersistence[
    keyof typeof SsoTokenPersistence
  ]
  readonly totalTimeoutMs?: number
  readonly pollIntervalMs?: number
  readonly requestTimeoutMs?: number
  readonly now?: () => number
  readonly boundaries: SsoOnboardingBoundaries
}

export type SsoOnboardingResult = {
  readonly status: typeof RESULT_STATUS.Authenticated
  readonly token?: Readonly<Record<string, unknown>>
}

export class SsoOnboardingError extends Error {
  readonly name = 'SsoOnboardingError'

  constructor(readonly code: SsoErrorCode, readonly status?: number) {
    super(
      status === undefined
        ? `LiteLLM SSO failed (${code}).`
        : `LiteLLM SSO failed (${code}, HTTP ${status}).`,
    )
  }
}

export type StartFlow = {
  readonly loginId: string
  readonly pollSecret: string
  readonly userCode: string
  readonly verificationUrl?: string
}

export type Credential = {
  readonly kind: typeof POLL_KIND.Credential
  readonly key: string
  readonly userId?: string
}

export type TeamChoice = {
  readonly kind: typeof POLL_KIND.TeamChoice
  readonly teams: readonly SsoTeam[]
  readonly userId?: string
}

export type PollResult = Credential | TeamChoice

export type PollOptions = {
  readonly baseUrl: string
  readonly fetcher: typeof globalThis.fetch
  readonly sleep: (milliseconds: number) => Promise<void>
  readonly now: () => number
  readonly deadlineMs: number
  readonly requestTimeoutMs: number
  readonly pollIntervalMs: number
  attemptsRemaining: number
}

export type SsoRequest = {
  readonly fetcher: typeof globalThis.fetch
  readonly url: string
  readonly init: RequestInit
  readonly timeoutMs: number
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

export function assertNever(value: never): never {
  throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
}
