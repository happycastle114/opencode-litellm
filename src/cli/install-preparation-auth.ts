import { join } from 'node:path'
import {
  type GatewayToolDiscoveryInput,
  type GatewayToolDiscoveryResult,
} from './gateway-tool-discovery'
import { InstallAuth, normalizeOrigin } from './install-intent'
import {
  onboardLiteLLMSso,
  type SsoOnboardingBoundaries,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
} from './onboarding-sso'
import type { OnboardingConnection, OnboardingIO } from './onboarding'
import { loadOfficialLiteLLMApiKey } from './official-token'

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
  | { readonly kind: typeof InstallCredentialKind.Environment; readonly apiKey: string }
  | { readonly kind: typeof InstallCredentialKind.StoredSso; readonly apiKey: string }
  | { readonly kind: typeof InstallCredentialKind.FreshSso; readonly apiKey: string }

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
      return environmentCredential(request.authEnv, request.boundary.env)
    case InstallAuth.Sso:
      return ssoCredential(request, origin)
    default:
      return assertNever(request.connection.auth)
  }
}

function environmentCredential(
  authEnv: string,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedCredential {
  const apiKey = env[authEnv]
  if (apiKey !== undefined && apiKey !== '') {
    return { kind: InstallCredentialKind.Environment, apiKey }
  }
  throw preparationError(
    InstallPreparationErrorCode.MissingEnvironmentCredential,
    `Environment variable '${authEnv}' is required for authenticated LiteLLM discovery.`,
  )
}

async function ssoCredential(
  request: ConnectionLoadRequest,
  origin: string,
): Promise<ResolvedCredential> {
  const tokenFilePath = resolveTokenFilePath(request.boundary)
  const existing = loadSsoKey(tokenFilePath, origin)
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
  if (request.boundary.ssoBoundaries === undefined) {
    throw preparationError(
      InstallPreparationErrorCode.SsoBoundariesUnavailable,
      'Interactive LiteLLM SSO requires browser and team-selection boundaries.',
    )
  }
  try {
    await (request.boundary.onboard ?? onboardLiteLLMSso)({
      baseUrl: origin,
      tokenFilePath,
      now: request.boundary.now,
      boundaries: request.boundary.ssoBoundaries,
    })
  } catch {
    throw preparationError(
      InstallPreparationErrorCode.SsoFailed,
      `LiteLLM SSO did not complete for ${origin}; rerun the interactive login.`,
    )
  }
  const refreshed = loadSsoKey(tokenFilePath, origin)
  if (refreshed === undefined) throw missingSsoCredential(origin)
  return { kind: InstallCredentialKind.FreshSso, apiKey: refreshed }
}

function loadSsoKey(tokenFilePath: string, origin: string): string | undefined {
  return loadOfficialLiteLLMApiKey({ tokenFilePath, expectedBaseURL: origin })
}

function resolveTokenFilePath(boundary: InstallPreparationBoundary): string {
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
  return join(home, ...TOKEN_PATH)
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
