import { join } from 'node:path'
import {
  type GatewayToolDiscoveryInput,
  type GatewayToolDiscoveryResult,
} from './gateway-tool-discovery'
import { InstallAuth, normalizeOrigin } from './install-intent'
import {
  onboardLiteLLMSso,
  SsoOnboardingError,
  type SsoOnboardingBoundaries,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
} from './onboarding-sso'
import type { OnboardingConnection, OnboardingIO } from './onboarding'
import { resolveManualLiteLLMApiKeyPath, loadOfficialLiteLLMApiKey, loadEnvKey } from './official-token'
import { isHeaderSafeApiKey } from '../utils/api-key'

const TOKEN_PATH = ['.litellm', 'token.json'] as const
export const InstallCredentialKind = {
  Environment: 'environment',
  StoredSso: 'stored-sso',
  FreshSso: 'fresh-sso',
} as const

export const InstallPreparationErrorCode = {
  InvalidGatewayOrigin: 'invalid-gateway-origin',
  HomeUnavailable: 'home-unavailable',
  MissingEnvironmentCredential: 'missing-environment-credential',
  MissingSsoCredential: 'missing-sso-credential',
  SsoReauthenticationRequired: 'sso-reauthentication-required',
  InteractiveIoUnavailable: 'interactive-io-unavailable',
  SsoBoundariesUnavailable: 'sso-boundaries-unavailable',
  SsoFailed: 'sso-failed',
  DiscoveryFailed: 'discovery-failed',
  OnboardingFailed: 'onboarding-failed',
  InvariantViolation: 'invariant-violation',
} as const

export type InstallPreparationErrorCode =
  (typeof InstallPreparationErrorCode)[keyof typeof InstallPreparationErrorCode]

export class InstallPreparationError extends Error {
  readonly name = 'InstallPreparationError'

  constructor(readonly code: InstallPreparationErrorCode, message: string) {
    super(message)
  }
}

type DiscoverBoundary = (
  input: GatewayToolDiscoveryInput,
) => Promise<GatewayToolDiscoveryResult>

type SsoBoundary = (input: SsoOnboardingInput) => Promise<SsoOnboardingResult>

export type InstallPreparationBoundary = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: () => string
  readonly now: () => number
  readonly onboardingIO?: OnboardingIO
  readonly ssoBoundaries?: SsoOnboardingBoundaries
  readonly discover?: DiscoverBoundary
  readonly onboard?: SsoBoundary
}

export type PrepareInstallBoundary = InstallPreparationBoundary

export type ConnectionLoadRequest = {
  readonly connection: OnboardingConnection
  readonly authEnv: string
  readonly interactive: boolean
  readonly boundary: InstallPreparationBoundary
}

export type ResolvedCredential =
  ({ readonly apiKey: string; readonly deferredApiKey?: DeferredApiKey }) & (
    | { readonly kind: typeof InstallCredentialKind.Environment }
    | { readonly kind: typeof InstallCredentialKind.StoredSso }
    | { readonly kind: typeof InstallCredentialKind.FreshSso }
  )

export type DeferredApiKey = {
  readonly contents: string
}

export function resolveGatewayOrigin(value: string): string {
  const origin = normalizeOrigin(value)
  if (origin !== undefined) return origin
  throw preparationError(
    InstallPreparationErrorCode.InvalidGatewayOrigin,
    'The LiteLLM gateway must be an absolute http(s) origin without credentials, query, or fragment.',
  )
}

export function preparationError(
  code: InstallPreparationErrorCode,
  message: string,
): InstallPreparationError {
  return new InstallPreparationError(code, message)
}

export async function resolveCredential(
  request: ConnectionLoadRequest,
  origin: string,
): Promise<ResolvedCredential> {
  switch (request.connection.auth) {
    case InstallAuth.Environment:
      return environmentCredential(request, origin)
    case InstallAuth.Sso:
      return ssoCredential(request, origin)
    default:
      return assertNever(request.connection.auth)
  }
}

async function environmentCredential(
  request: ConnectionLoadRequest,
  origin: string,
): Promise<ResolvedCredential> {
  const envKey = request.boundary.env[request.authEnv]
  if (isHeaderSafeApiKey(envKey)) {
    return { kind: InstallCredentialKind.Environment, apiKey: envKey }
  }
  const keyFilePath = resolveManualLiteLLMApiKeyPath({ ...request.boundary.env, HOME: resolveHomeDirectory(request.boundary) })
  const stored = loadEnvKey(keyFilePath, origin)
  if (stored !== undefined) {
    return { kind: InstallCredentialKind.Environment, apiKey: stored }
  }
  if (request.interactive && request.boundary.onboardingIO !== undefined) {
    const io = request.boundary.onboardingIO
    const entered = (await io.prompt(
      `Enter your LiteLLM API key (stored in ${keyFilePath} for reuse): `,
    )).trim()
    if (isHeaderSafeApiKey(entered)) {
      const token = {
        base_url: origin,
        key: entered,
      }
      return {
        kind: InstallCredentialKind.Environment,
        apiKey: entered,
        deferredApiKey: { contents: `${JSON.stringify(token, null, 2)}\n` },
      }
    }
  }
  throw preparationError(
    InstallPreparationErrorCode.MissingEnvironmentCredential,
    `Set '${request.authEnv}' or rerun install interactively to enter an API key for this gateway.`,
  )
}

async function ssoCredential(
  request: ConnectionLoadRequest,
  origin: string,
): Promise<ResolvedCredential> {
  const tokenFilePath = resolveTokenFilePath(request.boundary)
  const existing = loadSsoKey(tokenFilePath, origin, request.boundary.ssoBoundaries)
  if (existing !== undefined) {
    return { kind: InstallCredentialKind.StoredSso, apiKey: existing }
  }
  if (!request.interactive) throw missingSsoCredential(origin)
  return onboardSso(request, origin, tokenFilePath)
}

export function refreshSsoCredential(
  request: ConnectionLoadRequest,
  origin: string,
): Promise<ResolvedCredential> {
  return onboardSso(request, origin, resolveTokenFilePath(request.boundary))
}

async function onboardSso(
  request: ConnectionLoadRequest,
  origin: string,
  tokenFilePath: string,
): Promise<ResolvedCredential> {
  try {
    await (request.boundary.onboard ?? onboardLiteLLMSso)({
      baseUrl: origin,
      tokenFilePath,
      boundaries: request.boundary.ssoBoundaries,
    })
  } catch (error) {
    throw preparationError(
      InstallPreparationErrorCode.SsoFailed,
      error instanceof SsoOnboardingError
        ? error.message
        : `LiteLLM SSO did not complete for ${origin}; rerun the interactive login.`,
    )
  }
  const refreshed = loadSsoKey(tokenFilePath, origin, request.boundary.ssoBoundaries)
  if (refreshed === undefined) throw missingSsoCredential(origin)
  return { kind: InstallCredentialKind.FreshSso, apiKey: refreshed }
}

function loadSsoKey(
  tokenFilePath: string,
  origin: string,
  native: SsoOnboardingBoundaries | undefined,
): string | undefined {
  return loadOfficialLiteLLMApiKey({ tokenFilePath, expectedBaseURL: origin, native })
}

function resolveTokenFilePath(boundary: InstallPreparationBoundary): string {
  return join(resolveHomeDirectory(boundary), ...TOKEN_PATH)
}

function resolveHomeDirectory(boundary: InstallPreparationBoundary): string {
  const environmentHome = boundary.env.HOME
  let home = environmentHome
  if (home === undefined || home === '') {
    try {
      home = boundary.home()
    } catch {
      throw homeUnavailable()
    }
  }
  if (home === '') throw homeUnavailable()
  return home
}

function homeUnavailable(): InstallPreparationError {
  return preparationError(
    InstallPreparationErrorCode.HomeUnavailable,
    'Unable to resolve HOME for the official LiteLLM SSO token.',
  )
}

function missingSsoCredential(origin: string): InstallPreparationError {
  return preparationError(
    InstallPreparationErrorCode.MissingSsoCredential,
    `No exact-origin LiteLLM SSO token is available for ${origin}; run an interactive login and retry.`,
  )
}

function assertNever(value: never): never {
  throw preparationError(
    InstallPreparationErrorCode.InvariantViolation,
    'Install preparation reached an unsupported authentication variant.',
  )
}
