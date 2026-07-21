import { planClaudeMarketplaceAsset } from './claude-marketplace-asset'
import {
  AUTO_ROUTER_LIFECYCLE_COMMAND,
  AutoRouterMode,
  formatAutoRouterPlan,
  planAutoRouter,
  type AutoRouterPlan,
} from './auto-router-contracts'
import {
  AutoRouterError,
  AutoRouterErrorCode,
  applyAutoRouter,
  createNodeAutoRouterBoundary,
  preflightAutoRouter,
  type AutoRouterBoundary,
  type AutoRouterExecution,
} from './auto-router-process'
import {
  assertClientInstallDestinationsSafe,
  resolveClientInstallDestinations,
} from './client-install-destination-preflight'
import { withClientInstallPlanningLock } from './client-install-planning-lock'
import { installPreparedClients } from './client-installer'
import {
  createInstallSsoTokenContext,
  planInstallSsoTokenAsset,
  type InstallSsoTokenContext,
} from './install-sso-token'
import {
  prepareInstall,
  type PreparedInstall,
} from './install-preparation'
import type { InstallOptions } from './install-intent'
import {
  assertLaunchConfigPathWritable,
  loadLaunchConfigSnapshot,
  planLaunchConfigAsset,
  validateLaunchConfig,
} from './launch-config'
import { buildLaunchConfig } from './program-launch-plan'
import type { ProgramContext } from './program-contracts'
import type { CliResult } from './command'
import { PathResolutionError } from './paths'

type LockedInstallOutcome = {
  readonly prepared: PreparedInstall
  readonly autoRouterPlan: AutoRouterPlan
  readonly result: CliResult
}

type LockedInstallInput = {
  readonly prepared: PreparedInstall
  readonly context: ProgramContext
  readonly homeDirectory: string
  readonly token: InstallSsoTokenContext
}

type CompleteAutoRouterInput = {
  readonly outcome: LockedInstallOutcome
  readonly execution: AutoRouterExecution
  readonly boundary: AutoRouterBoundary
  readonly releaseTerminal: (() => void) | undefined
}

export async function runInstall(
  options: InstallOptions,
  context: ProgramContext,
): Promise<CliResult> {
  const homeDirectory = resolveHome(context)
  const boundary = context.autoRouterBoundary ?? createNodeAutoRouterBoundary()
  const tokenState: { current: InstallSsoTokenContext | undefined } = {
    current: undefined,
  }
  try {
    const outcome = await withClientInstallPlanningLock(homeDirectory, async () => {
      const token = createInstallSsoTokenContext(
        homeDirectory,
        context.ssoOnboarding,
      )
      tokenState.current = token
      const prepared = await prepareInstall(options, {
        env: context.env,
        home: () => homeDirectory,
        now: () => context.now().getTime(),
        ...(context.onboardingIO === undefined ? {} : { onboardingIO: context.onboardingIO }),
        ...(context.ssoBoundaries === undefined ? {} : { ssoBoundaries: context.ssoBoundaries }),
        ...(context.gatewayDiscovery === undefined ? {} : { discover: context.gatewayDiscovery }),
        ...(token.onboard === undefined ? {} : { onboard: token.onboard }),
      })
      const autoRouterPlan = planAutoRouter(prepared.options.autoRouter, homeDirectory)
      const execution = autoRouterExecution(prepared, context)
      preflightAutoRouter(autoRouterPlan, execution, boundary)
      const result = await runLockedInstall({ prepared, context, homeDirectory, token })
      return { prepared, autoRouterPlan, result }
    })
    return completeAutoRouter({
      outcome,
      execution: autoRouterExecution(outcome.prepared, context),
      boundary,
      releaseTerminal: context.releaseOnboardingTerminal,
    })
  } finally {
    tokenState.current?.cleanup()
  }
}

function completeAutoRouter(input: CompleteAutoRouterInput): CliResult {
  const { outcome } = input
  switch (outcome.autoRouterPlan.mode) {
    case AutoRouterMode.Skip:
      return outcome.result
    case AutoRouterMode.DryRun:
      return appendOutput(outcome.result, formatAutoRouterPlan(outcome.autoRouterPlan))
    case AutoRouterMode.Configure:
      input.releaseTerminal?.()
      try {
        applyAutoRouter(outcome.autoRouterPlan, input.execution, input.boundary)
      } catch (error: unknown) {
        const detail = error instanceof AutoRouterError
          ? error.message
          : 'the official LiteLLM Auto Router wizard did not complete.'
        return {
          exitCode: 1,
          stdout: outcome.result.stdout,
          stderr: `Client configuration completed, but Auto Router configuration failed: ${detail}\n`,
        }
      }
      return appendOutput(outcome.result, autoRouterSuccess(outcome.autoRouterPlan))
    default:
      return assertNever(outcome.autoRouterPlan.mode)
  }
}

function autoRouterExecution(
  prepared: PreparedInstall,
  context: ProgramContext,
): AutoRouterExecution {
  return {
    baseUrl: prepared.options.baseUrl,
    apiKey: prepared.apiKey,
    environment: context.env,
  }
}

function autoRouterSuccess(plan: AutoRouterPlan): string {
  return [
    `Configured official LiteLLM Auto Router: ${plan.configPath}`,
    'Scope: Claude Code only; OpenCode and Codex are unchanged.',
    'Security boundary: official LiteLLM persists the gateway provider API key in its 0600 config; this toolkit keeps it out of argv, output, Keychain, and toolkit-owned files.',
    `Start Auto Router: ${AUTO_ROUTER_LIFECYCLE_COMMAND.Up}`,
    `Stop Auto Router and restore Claude settings: ${AUTO_ROUTER_LIFECYCLE_COMMAND.Down}`,
    `After gateway key rotation: run the stop command, delete ${plan.configPath}, sign in again, then rerun install with --auto-router configure.`,
  ].join('\n')
}

function appendOutput(result: CliResult, message: string): CliResult {
  return { ...result, stdout: `${result.stdout}${message}\n` }
}

async function runLockedInstall(input: LockedInstallInput): Promise<CliResult> {
  const { prepared, context, homeDirectory, token } = input
  const destinations = resolveClientInstallDestinations(
    prepared.options,
    context.env,
    homeDirectory,
  )
  assertClientInstallDestinationsSafe(destinations)
  const launchConfigPath = destinations.launchConfig
  assertLaunchConfigPathWritable(launchConfigPath)
  const previousLaunchSnapshot = loadLaunchConfigSnapshot({
    env: context.env,
    path: launchConfigPath,
  })
  const launchPlan = buildLaunchConfig(
    previousLaunchSnapshot.config,
    prepared.options,
    destinations,
  )
  validateLaunchConfig(launchPlan.config)
  const launchAsset = planLaunchConfigAsset(launchPlan.config, {
    env: context.env,
    path: launchConfigPath,
    expectation: previousLaunchSnapshot.expectation,
  })
  const claudeMarketplaceAsset = planClaudeMarketplaceAsset({
    homeDirectory,
    gatewayOrigin: prepared.options.baseUrl,
    settingsPath: destinations.claudeSettings,
  })
  const tokenAsset = planInstallSsoTokenAsset(prepared, token)
  const result = await installPreparedClients(prepared, context, [
    claudeMarketplaceAsset,
    ...(tokenAsset === undefined ? [] : [tokenAsset]),
    launchAsset,
  ], destinations)
  const lines = [
    ...result.configured.map((entry) => `Configured ${entry.client}: ${entry.path}`),
    `Configured Claude marketplace: ${claudeMarketplaceAsset.path}`,
    `Configured launch intent: ${launchAsset.path}`,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    ...launchPlan.warnings.map((warning) => `Warning: ${warning}`),
  ]
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
}

function resolveHome(context: ProgramContext): string {
  const home = context.env.HOME
  if (home !== undefined && home !== '') return home
  throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
}

function assertNever(value: never): never {
  throw new AutoRouterError(
    AutoRouterErrorCode.InvariantViolation,
    `Unsupported Auto Router completion mode: ${String(value)}`,
  )
}
