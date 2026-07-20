import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'

const ENDPOINT = { Start: '/sso/cli/start', Poll: '/sso/cli/poll/', Verify: '/sso/key/generate' } as const
const RESPONSE_STATUS = { Pending: 'pending', Ready: 'ready' } as const
const RESULT_STATUS = { Authenticated: 'authenticated' } as const
const POLL_KIND = { Credential: 'credential', TeamChoice: 'team-choice' } as const

const ERROR_CODE = {
  InvalidBaseUrl: 'invalid_base_url', StartRequest: 'start_request_failed',
  StartHttp: 'start_http_failed', InvalidStart: 'invalid_start_response',
  CrossOriginVerification: 'cross_origin_verification', VerificationOpen: 'verification_open_failed',
  PollHttpPermanent: 'poll_http_permanent', InvalidPoll: 'invalid_poll_response',
  AuthenticationTimeout: 'authentication_timeout', TeamSelectionRequired: 'team_selection_required',
  InvalidTeamSelection: 'invalid_team_selection', TokenWrite: 'token_write_failed',
} as const

type SsoErrorCode = typeof ERROR_CODE[keyof typeof ERROR_CODE]

const HTTP = { ClientMinimum: 400, ClientMaximum: 499, RateLimited: 429, ServerMinimum: 500 } as const

const [FILE_MODE, DIRECTORY_MODE] = [0o600, 0o700] as const
const [DEFAULT_TOTAL_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS, DEFAULT_REQUEST_TIMEOUT_MS] = [300_000, 2_000, 10_000] as const
const PLATFORM = { Windows: 'win32' } as const
const ALLOWED_PROTOCOLS = new Set<string>(['http:', 'https:'])
const IS_WINDOWS = process.platform === PLATFORM.Windows

export type SsoVerification = { readonly url: string; readonly userCode: string }
export type SsoTeam = { readonly teamId: string; readonly teamAlias?: string }

export type SsoOnboardingBoundaries = {
  readonly fetch?: typeof globalThis.fetch; readonly sleep?: (milliseconds: number) => Promise<void>
  readonly open: (verification: SsoVerification) => Promise<void>
  readonly selectTeam: (teams: readonly SsoTeam[]) => Promise<string | undefined>
}

export type SsoOnboardingInput = {
  readonly baseUrl: string; readonly tokenFilePath?: string
  readonly totalTimeoutMs?: number; readonly pollIntervalMs?: number
  readonly requestTimeoutMs?: number; readonly now?: () => number
  readonly boundaries: SsoOnboardingBoundaries
}

export type SsoOnboardingResult = { readonly status: typeof RESULT_STATUS.Authenticated }

export class SsoOnboardingError extends Error {
  readonly name = 'SsoOnboardingError'
  constructor(readonly code: SsoErrorCode, readonly status?: number) {
    super(status === undefined ? `LiteLLM SSO failed (${code}).` : `LiteLLM SSO failed (${code}, HTTP ${status}).`)
  }
}

export async function onboardLiteLLMSso(input: SsoOnboardingInput): Promise<SsoOnboardingResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const fetcher = input.boundaries.fetch ?? globalThis.fetch
  const sleep = input.boundaries.sleep ?? sleepFor
  const requestTimeoutMs = positive(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  const pollIntervalMs = positive(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
  const pollOptions: PollOptions = {
    baseUrl,
    fetcher,
    sleep,
    requestTimeoutMs,
    pollIntervalMs,
    attempts: Math.max(1, Math.ceil(positive(input.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS) / pollIntervalMs)),
  }
  const start = await startFlow(baseUrl, fetcher, requestTimeoutMs)
  const verification = verificationFor(baseUrl, start)
  try { await input.boundaries.open(verification) }
  catch { throw new SsoOnboardingError(ERROR_CODE.VerificationOpen) }

  const first = await poll(pollOptions, start, undefined)
  let credential: Credential
  switch (first.kind) {
    case POLL_KIND.Credential: credential = first; break
    case POLL_KIND.TeamChoice: {
      const selected = await input.boundaries.selectTeam(first.teams)
      if (selected === undefined) throw new SsoOnboardingError(ERROR_CODE.TeamSelectionRequired)
      if (!first.teams.some((team) => team.teamId === selected)) throw new SsoOnboardingError(ERROR_CODE.InvalidTeamSelection)
      const second = await poll(pollOptions, start, selected)
      switch (second.kind) {
        case POLL_KIND.Credential:
          credential = second.userId === undefined && first.userId !== undefined ? { ...second, userId: first.userId } : second
          break
        case POLL_KIND.TeamChoice: throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
        default: assertNever(second)
      }
      break
    }
    default: assertNever(first)
  }

  const tokenPath = input.tokenFilePath ?? join(process.env.HOME ?? homedir(), '.litellm', 'token.json')
  persistToken(tokenPath, {
    base_url: baseUrl, key: credential.key,
    user_id: credential.userId ?? 'cli-user', user_email: 'unknown',
    user_role: 'cli', auth_header_name: 'Authorization', jwt_token: '',
    timestamp: (input.now?.() ?? Date.now()) / 1000,
  })
  return { status: RESULT_STATUS.Authenticated }
}

type StartFlow = {
  readonly loginId: string; readonly pollSecret: string
  readonly userCode: string; readonly verificationUrl?: string
}
type Credential = { readonly kind: typeof POLL_KIND.Credential; readonly key: string; readonly userId?: string }
type TeamChoice = { readonly kind: typeof POLL_KIND.TeamChoice; readonly teams: readonly SsoTeam[]; readonly userId?: string }

type PollResult = Credential | TeamChoice

type PollOptions = {
  readonly baseUrl: string; readonly fetcher: typeof globalThis.fetch
  readonly sleep: (milliseconds: number) => Promise<void>
  readonly requestTimeoutMs: number; readonly pollIntervalMs: number; readonly attempts: number
}
type SsoRequest = { readonly fetcher: typeof globalThis.fetch; readonly url: string; readonly init: RequestInit; readonly timeoutMs: number }

async function startFlow(
  baseUrl: string, fetcher: typeof globalThis.fetch, requestTimeoutMs: number,
): Promise<StartFlow> {
  let response: Response
  try {
    response = await request({ fetcher, url: `${baseUrl}${ENDPOINT.Start}`, init: { method: 'POST' }, timeoutMs: requestTimeoutMs })
  } catch {
    throw new SsoOnboardingError(ERROR_CODE.StartRequest)
  }
  if (!response.ok) throw new SsoOnboardingError(ERROR_CODE.StartHttp, response.status)
  const payload = await json(response, ERROR_CODE.InvalidStart)
  if (!isRecord(payload)) throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  const loginId = nonEmpty(payload.login_id)
  const pollSecret = nonEmpty(payload.poll_secret)
  const userCode = nonEmpty(payload.user_code)
  if (loginId === undefined || pollSecret === undefined || userCode === undefined) throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  const verificationUrl = payload.verification_uri_complete
  if (verificationUrl !== undefined && nonEmpty(verificationUrl) === undefined) throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  return typeof verificationUrl === 'string' ? { loginId, pollSecret, userCode, verificationUrl } : { loginId, pollSecret, userCode }
}

function verificationFor(baseUrl: string, start: StartFlow): SsoVerification {
  if (start.verificationUrl !== undefined) {
    let verification: URL
    try {
      verification = new URL(start.verificationUrl)
    } catch {
      throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
    }
    const expected = new URL(baseUrl)
    if (verification.origin !== expected.origin || verification.username.length > 0 || verification.password.length > 0) throw new SsoOnboardingError(ERROR_CODE.CrossOriginVerification)
    return { url: start.verificationUrl, userCode: start.userCode }
  }
  const query = new URLSearchParams({ source: 'litellm-cli', key: start.loginId })
  return { url: `${baseUrl}${ENDPOINT.Verify}?${query}`, userCode: start.userCode }
}

async function poll(options: PollOptions, start: StartFlow, teamId: string | undefined): Promise<PollResult> {
  const teamQuery = teamId === undefined ? '' : `?${new URLSearchParams({ team_id: teamId })}`
  const url = `${options.baseUrl}${ENDPOINT.Poll}${encodeURIComponent(start.loginId)}${teamQuery}`
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    let response: Response | undefined
    try {
      response = await request({
        fetcher: options.fetcher, url, timeoutMs: options.requestTimeoutMs,
        init: { method: 'GET', headers: { 'x-litellm-cli-poll-secret': start.pollSecret } },
      })
    } catch {
      response = undefined
    }
    if (response?.ok) {
      const result = parsePoll(await json(response, ERROR_CODE.InvalidPoll))
      if (result !== undefined) return result
    } else if (response !== undefined && isPermanent(response.status)) {
      throw new SsoOnboardingError(ERROR_CODE.PollHttpPermanent, response.status)
    } else if (response !== undefined && response.status < HTTP.ServerMinimum && response.status !== HTTP.RateLimited) {
      throw new SsoOnboardingError(ERROR_CODE.InvalidPoll, response.status)
    }
    if (attempt + 1 < options.attempts) await options.sleep(options.pollIntervalMs)
  }
  throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
}

function parsePoll(payload: unknown): PollResult | undefined {
  if (!isRecord(payload)) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
  if (payload.status === RESPONSE_STATUS.Pending) return undefined
  if (payload.status !== RESPONSE_STATUS.Ready) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
  const userId = nonEmpty(payload.user_id)
  if (payload.requires_team_selection === true) {
    const teams = readTeams(payload)
    if (teams.length === 0) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
    return userId === undefined
      ? { kind: POLL_KIND.TeamChoice, teams }
      : { kind: POLL_KIND.TeamChoice, teams, userId }
  }
  const key = nonEmpty(payload.key)
  if (key === undefined) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
  return userId === undefined
    ? { kind: POLL_KIND.Credential, key }
    : { kind: POLL_KIND.Credential, key, userId }
}

function readTeams(payload: Readonly<Record<string, unknown>>): readonly SsoTeam[] {
  if (Array.isArray(payload.team_details) && payload.team_details.length > 0) {
    return payload.team_details.flatMap((entry): readonly SsoTeam[] => {
      if (!isRecord(entry)) return []
      const teamId = nonEmpty(entry.team_id) ?? nonEmpty(entry.id)
      if (teamId === undefined) return []
      const teamAlias = nonEmpty(entry.team_alias)
      return teamAlias === undefined ? [{ teamId }] : [{ teamId, teamAlias }]
    })
  }
  if (!Array.isArray(payload.teams)) return []
  return payload.teams.flatMap((team): readonly SsoTeam[] => {
    const teamId = nonEmpty(team)
    return teamId === undefined ? [] : [{ teamId }]
  })
}

async function request(input: SsoRequest): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    return await input.fetcher(input.url, { ...input.init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function json(response: Response, code: SsoErrorCode): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new SsoOnboardingError(code)
  }
}

function persistToken(path: string, token: Readonly<Record<string, unknown>>): void {
  const directory = dirname(path)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  let temporaryCreated = false
  try {
    mkdirSync(directory, { recursive: true, ...(IS_WINDOWS ? {} : { mode: DIRECTORY_MODE }) })
    writeFileSync(temporary, JSON.stringify(token, null, 2), {
      encoding: 'utf8', flag: 'wx', ...(IS_WINDOWS ? {} : { mode: FILE_MODE }),
    })
    temporaryCreated = true
    renameSync(temporary, path)
    if (!IS_WINDOWS) chmodSync(path, FILE_MODE)
  } catch {
    if (temporaryCreated && existsSync(temporary)) unlinkSync(temporary)
    throw new SsoOnboardingError(ERROR_CODE.TokenWrite)
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new SsoOnboardingError(ERROR_CODE.InvalidBaseUrl)
  }
  if (
    !ALLOWED_PROTOCOLS.has(url.protocol) || url.username.length > 0 || url.password.length > 0 ||
    url.search.length > 0 || url.hash.length > 0
  ) throw new SsoOnboardingError(ERROR_CODE.InvalidBaseUrl)
  return normalized
}

function isPermanent(status: number): boolean { return status >= HTTP.ClientMinimum && status <= HTTP.ClientMaximum && status !== HTTP.RateLimited }
function nonEmpty(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function positive(value: number | undefined, fallback: number): number { return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback }
function assertNever(value: never): never { throw new SsoOnboardingError(ERROR_CODE.InvalidPoll) }
