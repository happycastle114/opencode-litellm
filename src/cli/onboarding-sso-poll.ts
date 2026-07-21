import {
  ENDPOINT,
  ERROR_CODE,
  HTTP,
  POLL_KIND,
  RESPONSE_STATUS,
  SsoOnboardingError,
  type PollOptions,
  type PollResult,
  type SsoTeam,
  type StartFlow,
  isRecord,
  nonEmpty,
} from './onboarding-sso-contracts'
import { isHeaderSafeApiKey } from '../utils/api-key'
import { json, request } from './onboarding-sso-http'

export async function pollSso(
  options: PollOptions,
  start: StartFlow,
  teamId: string | undefined,
): Promise<PollResult> {
  const teamQuery = teamId === undefined
    ? ''
    : `?${new URLSearchParams({ team_id: teamId })}`
  const url = `${options.baseUrl}${ENDPOINT.Poll}${encodeURIComponent(start.loginId)}${teamQuery}`

  while (options.attemptsRemaining > 0) {
    const remainingBeforeRequest = options.deadlineMs - options.now()
    if (remainingBeforeRequest <= 0) {
      throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
    }
    options.attemptsRemaining -= 1
    let response: Response | undefined
    try {
      response = await request({
        fetcher: options.fetcher,
        url,
        timeoutMs: Math.min(options.requestTimeoutMs, remainingBeforeRequest),
        init: { method: 'GET', headers: { 'x-litellm-cli-poll-secret': start.pollSecret } },
      })
    } catch {
      response = undefined
    }

    const remainingAfterRequest = options.deadlineMs - options.now()
    if (remainingAfterRequest <= 0) {
      throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
    }
    if (response?.ok) {
      const result = parsePoll(await json(response, ERROR_CODE.InvalidPoll))
      if (options.deadlineMs - options.now() <= 0) {
        throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
      }
      if (result !== undefined) return result
    } else if (response !== undefined && isPermanent(response.status)) {
      throw new SsoOnboardingError(ERROR_CODE.PollHttpPermanent, response.status)
    } else if (
      response !== undefined &&
      response.status < HTTP.ServerMinimum &&
      response.status !== HTTP.RateLimited
    ) {
      throw new SsoOnboardingError(ERROR_CODE.InvalidPoll, response.status)
    }
    if (options.attemptsRemaining > 0) {
      const remainingBeforeSleep = options.deadlineMs - options.now()
      if (remainingBeforeSleep <= 0) {
        throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
      }
      await options.sleep(Math.min(options.pollIntervalMs, remainingBeforeSleep))
    }
  }
  throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
}

function parsePoll(payload: unknown): PollResult | undefined {
  if (!isRecord(payload)) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
  if (payload.status === RESPONSE_STATUS.Pending) return undefined
  if (payload.status !== RESPONSE_STATUS.Ready) {
    throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
  }
  const userId = nonEmpty(payload.user_id)
  if (payload.requires_team_selection === true) {
    const teams = readTeams(payload)
    if (teams.length === 0) throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
    return userId === undefined
      ? { kind: POLL_KIND.TeamChoice, teams }
      : { kind: POLL_KIND.TeamChoice, teams, userId }
  }
  const key = isHeaderSafeApiKey(payload.key) ? payload.key : undefined
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

function isPermanent(status: number): boolean {
  return status >= HTTP.ClientMinimum &&
    status <= HTTP.ClientMaximum &&
    status !== HTTP.RateLimited
}
