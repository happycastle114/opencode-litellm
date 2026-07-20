import type { GatewayToolDiscoveryResult } from './gateway-tool-discovery'
import { CodexMode, InstallTarget, ToolkitDefault, type InstallOptions } from './install-intent'
import {
  InstallPreparationError,
  InstallPreparationErrorCode,
  preparationError,
  resolveGatewayOrigin,
  type InstallPreparationBoundary,
} from './install-preparation-auth'
import { loadAuthenticatedConnection,
  type AuthenticatedConnection } from './install-preparation-discovery'
import { resourcesForOnboarding, selectDisabledMcp, selectInstallResources,
  type InstallSelection, type InstallSelectionWarning } from './install-preparation-selection'
import { runInstallOnboarding, type OnboardingConnection, type OnboardingPlan,
  type OnboardingResult } from './onboarding'

export {
  InstallPreparationError, InstallPreparationErrorCode,
  type InstallPreparationBoundary, type PrepareInstallBoundary,
} from './install-preparation-auth'
export {
  INSTALL_SELECTION_RESOURCE, INSTALL_SELECTION_WARNING_KIND,
  type InstallSelectionResource, type InstallSelectionWarning,
} from './install-preparation-selection'

export type ResolvedInstallOptions = Omit<InstallOptions, 'baseUrl' | 'authEnv'> & {
  readonly baseUrl: string
  readonly authEnv: string
}

export type PreparedInstall = {
  readonly options: ResolvedInstallOptions
  readonly apiKey: string
  readonly discovery: GatewayToolDiscoveryResult
  readonly selectionWarnings: readonly InstallSelectionWarning[]
}

type PreparationInput = {
  readonly options: InstallOptions
  readonly boundary: InstallPreparationBoundary
  readonly origin: string
  readonly authEnv: string
}

type InteractiveResultInput = {
  readonly preparation: PreparationInput
  readonly plan: OnboardingPlan
  readonly connection: AuthenticatedConnection
  readonly disabledMcp: InstallSelection
}

export async function prepareInstall(
  options: InstallOptions,
  boundary: InstallPreparationBoundary,
): Promise<PreparedInstall> {
  const origin = resolveGatewayOrigin(options.baseUrl ?? ToolkitDefault.GatewayOrigin)
  const input = {
    options,
    boundary,
    origin,
    authEnv: options.authEnv ?? ToolkitDefault.AuthEnvironment,
  }
  return options.nonInteractive
    ? prepareNonInteractive(input)
    : prepareInteractive(input)
}

async function prepareNonInteractive(input: PreparationInput): Promise<PreparedInstall> {
  const connection = await loadAuthenticatedConnection({
    connection: connectionForOptions(input.options, input.origin),
    authEnv: input.authEnv,
    interactive: false,
    boundary: input.boundary,
  })
  const selected = selectInstallResources(input.options, connection.discovery)
  return {
    options: {
      ...input.options,
      baseUrl: connection.origin,
      authEnv: input.authEnv,
      search: selected.search.names,
      mcp: selected.mcp.names,
      toolsets: selected.toolsets.names,
      disableMcp: selected.disabledMcp.names,
    },
    apiKey: connection.apiKey,
    discovery: connection.discovery,
    selectionWarnings: [
      ...selected.search.warnings,
      ...selected.mcp.warnings,
      ...selected.toolsets.warnings,
      ...selected.disabledMcp.warnings,
    ],
  }
}

async function prepareInteractive(input: PreparationInput): Promise<PreparedInstall> {
  const io = input.boundary.onboardingIO
  if (io === undefined) {
    throw preparationError(
      InstallPreparationErrorCode.InteractiveIoUnavailable,
      'Interactive install preparation requires an onboarding terminal boundary.',
    )
  }
  const state: { connection: AuthenticatedConnection | undefined } = { connection: undefined }
  let result: OnboardingResult
  try {
    result = await runInstallOnboarding({
      defaultTarget: input.options.target,
      defaultGatewayOrigin: input.origin,
      defaultAuth: input.options.auth,
      defaultCodexMode: input.options.codexMode,
      searchTools: [], mcpServers: [], mcpToolsets: [],
      loadResources: async (selectedConnection) => {
        const connection = await loadAuthenticatedConnection({
          connection: selectedConnection,
          authEnv: input.authEnv,
          interactive: true,
          boundary: input.boundary,
        })
        state.connection = connection
        return resourcesForOnboarding(connection.discovery, input.options)
      },
    }, io)
  } catch (error: unknown) {
    if (error instanceof InstallPreparationError) throw error
    throw preparationError(
      InstallPreparationErrorCode.OnboardingFailed,
      'Interactive install onboarding failed before confirmation.',
    )
  }
  if (!result.ok) {
    throw preparationError(InstallPreparationErrorCode.OnboardingFailed, result.failure.message)
  }
  const connection = state.connection
  if (connection === undefined) {
    throw preparationError(
      InstallPreparationErrorCode.InvariantViolation,
      'Interactive install preparation did not load gateway resources.',
    )
  }
  return interactiveResult({
    preparation: input,
    plan: result.plan,
    connection,
    disabledMcp: selectDisabledMcp(input.options, connection.discovery),
  })
}

function interactiveResult(input: InteractiveResultInput): PreparedInstall {
  const { preparation, plan, connection, disabledMcp } = input
  return {
    options: {
      ...preparation.options,
      target: plan.target,
      baseUrl: connection.origin,
      auth: plan.auth,
      authEnv: preparation.authEnv,
      codexMode: codexModeFor(plan, preparation.options.codexMode),
      search: preparation.options.noSearch ? [] : plan.searchTools,
      mcp: preparation.options.noMcp ? [] : plan.mcpServers,
      toolsets: preparation.options.noToolsets ? [] : plan.mcpToolsets,
      disableMcp: disabledMcp.names,
    },
    apiKey: connection.apiKey,
    discovery: connection.discovery,
    selectionWarnings: disabledMcp.warnings,
  }
}

function connectionForOptions(
  options: InstallOptions,
  origin: string,
): OnboardingConnection {
  switch (options.target) {
    case InstallTarget.OpenCode:
      return { target: options.target, gatewayOrigin: origin, auth: options.auth }
    case InstallTarget.Codex:
    case InstallTarget.Both:
      return {
        target: options.target,
        gatewayOrigin: origin,
        auth: options.auth,
        codexMode: options.codexMode,
      }
    default:
      return assertNever(options.target)
  }
}

function codexModeFor(plan: OnboardingPlan, fallback: CodexMode): CodexMode {
  switch (plan.target) {
    case InstallTarget.OpenCode:
      return fallback
    case InstallTarget.Codex:
    case InstallTarget.Both:
      return plan.codexMode
    default:
      return assertNever(plan)
  }
}

function assertNever(value: never): never {
  throw preparationError(
    InstallPreparationErrorCode.InvariantViolation,
    'Install preparation reached an unsupported typed variant.',
  )
}
