import { CodexDiscoveryError } from './codex-discovery'
import {
  discoverGatewayTools,
  type GatewayToolDiscoveryResult,
} from './gateway-tool-discovery'
import {
  InstallCredentialKind,
  InstallPreparationErrorCode,
  preparationError,
  refreshSsoCredential,
  resolveCredential,
  resolveGatewayOrigin,
  type ConnectionLoadRequest,
  type InstallPreparationError,
  type ResolvedCredential,
} from './install-preparation-auth'

const HTTP_STATUS = { Unauthorized: 401, Forbidden: 403 } as const

export type AuthenticatedConnection = {
  readonly origin: string
  readonly apiKey: string
  readonly discovery: GatewayToolDiscoveryResult
}

type RecoveryRequest = {
  readonly load: ConnectionLoadRequest
  readonly origin: string
  readonly credential: ResolvedCredential
  readonly failure: CodexDiscoveryError
}

export async function loadAuthenticatedConnection(
  request: ConnectionLoadRequest,
): Promise<AuthenticatedConnection> {
  const origin = resolveGatewayOrigin(request.connection.gatewayOrigin)
  const credential = await resolveCredential(request, origin)
  try {
    const discovery = await runDiscovery(request, origin, credential.apiKey)
    return { origin, apiKey: credential.apiKey, discovery }
  } catch (failure: unknown) {
    if (!(failure instanceof CodexDiscoveryError)) throw discoveryFailed(origin)
    return recoverDiscovery({ load: request, origin, credential, failure })
  }
}

async function recoverDiscovery(input: RecoveryRequest): Promise<AuthenticatedConnection> {
  if (!isAuthenticationFailure(input.failure)) throw discoveryFailed(input.origin)
  switch (input.credential.kind) {
    case InstallCredentialKind.Environment:
      throw discoveryFailed(input.origin)
    case InstallCredentialKind.FreshSso:
      throw reauthenticationRequired(input.origin)
    case InstallCredentialKind.StoredSso: {
      if (!input.load.interactive) throw reauthenticationRequired(input.origin)
      const refreshed = await refreshSsoCredential(input.load, input.origin)
      try {
        const discovery = await runDiscovery(input.load, input.origin, refreshed.apiKey)
        return { origin: input.origin, apiKey: refreshed.apiKey, discovery }
      } catch (failure: unknown) {
        if (!(failure instanceof CodexDiscoveryError)) throw discoveryFailed(input.origin)
        if (isAuthenticationFailure(failure)) throw reauthenticationRequired(input.origin)
        throw discoveryFailed(input.origin)
      }
    }
    default:
      return assertNever(input.credential)
  }
}

function runDiscovery(
  request: ConnectionLoadRequest,
  origin: string,
  apiKey: string,
): Promise<GatewayToolDiscoveryResult> {
  return (request.boundary.discover ?? discoverGatewayTools)({ origin, apiKey })
}

function isAuthenticationFailure(failure: CodexDiscoveryError): boolean {
  return failure.status === HTTP_STATUS.Unauthorized || failure.status === HTTP_STATUS.Forbidden
}

function discoveryFailed(origin: string): InstallPreparationError {
  return preparationError(
    InstallPreparationErrorCode.DiscoveryFailed,
    `Authenticated LiteLLM gateway discovery failed for ${origin}.`,
  )
}

function reauthenticationRequired(origin: string): InstallPreparationError {
  return preparationError(
    InstallPreparationErrorCode.SsoReauthenticationRequired,
    `LiteLLM SSO authorization for ${origin} was rejected; run an interactive login and retry.`,
  )
}

function assertNever(value: never): never {
  throw preparationError(
    InstallPreparationErrorCode.InvariantViolation,
    'Install preparation reached an unsupported credential variant.',
  )
}
