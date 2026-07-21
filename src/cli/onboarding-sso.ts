import { setTimeout as sleepFor } from 'node:timers/promises'
import {
  ERROR_CODE,
  POLL_KIND,
  RESULT_STATUS,
  SsoOnboardingError,
  SsoTokenPersistence,
  type Credential,
  type PollOptions,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
  assertNever,
  positive,
} from './onboarding-sso-contracts'
import {
  normalizeBaseUrl,
  startSsoFlow,
  verificationFor,
} from './onboarding-sso-http'
import { pollSso } from './onboarding-sso-poll'
import { createSsoToken, defaultTokenPath, persistSsoToken } from './onboarding-sso-token'

export {
  SsoOnboardingError,
  SsoTokenPersistence,
  type SsoOnboardingBoundaries,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
  type SsoTeam,
  type SsoVerification,
} from './onboarding-sso-contracts'

const DEFAULT_TOTAL_TIMEOUT_MS = 300_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export async function onboardLiteLLMSso(input: SsoOnboardingInput): Promise<SsoOnboardingResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const fetcher = input.boundaries.fetch ?? globalThis.fetch
  const sleep = input.boundaries.sleep ?? sleepFor
  const now = input.now ?? Date.now
  const requestTimeoutMs = positive(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  const pollIntervalMs = positive(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
  const totalTimeoutMs = positive(input.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS)
  const attemptsRemaining = Math.max(1, Math.ceil(totalTimeoutMs / pollIntervalMs))
  const start = await startSsoFlow(baseUrl, fetcher, requestTimeoutMs)
  const verification = verificationFor(baseUrl, start)
  try {
    await input.boundaries.open(verification)
  } catch {
    throw new SsoOnboardingError(ERROR_CODE.VerificationOpen)
  }
  const pollOptions: PollOptions = {
    baseUrl,
    fetcher,
    sleep,
    now,
    deadlineMs: now() + totalTimeoutMs,
    requestTimeoutMs,
    pollIntervalMs,
    attemptsRemaining,
  }

  const first = await pollSso(pollOptions, start, undefined)
  let credential: Credential
  switch (first.kind) {
    case POLL_KIND.Credential:
      credential = first
      break
    case POLL_KIND.TeamChoice: {
      const selected = await input.boundaries.selectTeam(first.teams)
      if (pollOptions.deadlineMs - now() <= 0) {
        throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
      }
      if (selected === undefined) throw new SsoOnboardingError(ERROR_CODE.TeamSelectionRequired)
      if (!first.teams.some((team) => team.teamId === selected)) {
        throw new SsoOnboardingError(ERROR_CODE.InvalidTeamSelection)
      }
      const second = await pollSso(pollOptions, start, selected)
      switch (second.kind) {
        case POLL_KIND.Credential:
          credential = second.userId === undefined && first.userId !== undefined
            ? { ...second, userId: first.userId }
            : second
          break
        case POLL_KIND.TeamChoice:
          throw new SsoOnboardingError(ERROR_CODE.InvalidPoll)
        default:
          return assertNever(second)
      }
      break
    }
    default:
      return assertNever(first)
  }

  const completedAt = now()
  if (completedAt >= pollOptions.deadlineMs) {
    throw new SsoOnboardingError(ERROR_CODE.AuthenticationTimeout)
  }
  const token = createSsoToken(baseUrl, credential, completedAt)
  if (input.tokenPersistence === SsoTokenPersistence.Defer) {
    return { status: RESULT_STATUS.Authenticated, token }
  }
  persistSsoToken(input.tokenFilePath ?? defaultTokenPath(), token)
  return { status: RESULT_STATUS.Authenticated }
}
