import {
  ALLOWED_PROTOCOLS,
  ENDPOINT,
  ERROR_CODE,
  SsoOnboardingError,
  type SsoRequest,
  type StartFlow,
  isRecord,
  nonEmpty,
} from './onboarding-sso-contracts'

const BASE_URL_SUFFIX = /\/+$/

export async function startSsoFlow(
  baseUrl: string,
  fetcher: typeof globalThis.fetch,
  requestTimeoutMs: number,
): Promise<StartFlow> {
  let response: Response
  try {
    response = await request({
      fetcher,
      url: `${baseUrl}${ENDPOINT.Start}`,
      init: { method: 'POST' },
      timeoutMs: requestTimeoutMs,
    })
  } catch {
    throw new SsoOnboardingError(ERROR_CODE.StartRequest)
  }
  if (!response.ok) throw new SsoOnboardingError(ERROR_CODE.StartHttp, response.status)

  const payload = await json(response, ERROR_CODE.InvalidStart)
  if (!isRecord(payload)) throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  const loginId = nonEmpty(payload.login_id)
  const pollSecret = nonEmpty(payload.poll_secret)
  const userCode = nonEmpty(payload.user_code)
  if (loginId === undefined || pollSecret === undefined || userCode === undefined) {
    throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  }
  const verificationUrl = payload.verification_uri_complete
  if (verificationUrl !== undefined && nonEmpty(verificationUrl) === undefined) {
    throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
  }
  return typeof verificationUrl === 'string'
    ? { loginId, pollSecret, userCode, verificationUrl }
    : { loginId, pollSecret, userCode }
}

export function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(BASE_URL_SUFFIX, '')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new SsoOnboardingError(ERROR_CODE.InvalidBaseUrl)
  }
  if (
    !ALLOWED_PROTOCOLS.has(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new SsoOnboardingError(ERROR_CODE.InvalidBaseUrl)
  }
  return normalized
}

export function verificationFor(
  baseUrl: string,
  start: StartFlow,
): { readonly url: string; readonly userCode: string } {
  if (start.verificationUrl !== undefined) {
    let verification: URL
    try {
      verification = new URL(start.verificationUrl)
    } catch {
      throw new SsoOnboardingError(ERROR_CODE.InvalidStart)
    }
    const expected = new URL(baseUrl)
    if (
      verification.origin !== expected.origin ||
      verification.username.length > 0 ||
      verification.password.length > 0
    ) {
      throw new SsoOnboardingError(ERROR_CODE.CrossOriginVerification)
    }
    return { url: start.verificationUrl, userCode: start.userCode }
  }
  const query = new URLSearchParams({ source: 'litellm-cli', key: start.loginId })
  return { url: `${baseUrl}${ENDPOINT.Verify}?${query}`, userCode: start.userCode }
}

export async function request(input: SsoRequest): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    return await input.fetcher(input.url, { ...input.init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function json(response: Response, code: typeof ERROR_CODE[keyof typeof ERROR_CODE]): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new SsoOnboardingError(code)
  }
}
