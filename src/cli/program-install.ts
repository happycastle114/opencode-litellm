import { planClaudeMarketplaceAsset } from './claude-marketplace-asset'
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

export async function runInstall(
  options: InstallOptions,
  context: ProgramContext,
): Promise<CliResult> {
  const homeDirectory = resolveHome(context)
  return withClientInstallPlanningLock(homeDirectory, async () => {
    const token = createInstallSsoTokenContext(
      homeDirectory,
      context.ssoOnboarding,
    )
    try {
      const prepared = await prepareInstall(options, {
        env: context.env,
        home: () => homeDirectory,
        now: () => context.now().getTime(),
        ...(context.onboardingIO === undefined ? {} : { onboardingIO: context.onboardingIO }),
        ...(context.ssoBoundaries === undefined ? {} : { ssoBoundaries: context.ssoBoundaries }),
        ...(context.gatewayDiscovery === undefined ? {} : { discover: context.gatewayDiscovery }),
        ...(token.onboard === undefined ? {} : { onboard: token.onboard }),
      })
      return runLockedInstall(prepared, context, homeDirectory, token)
    } finally {
      token.cleanup()
    }
  })
}

async function runLockedInstall(
  prepared: PreparedInstall,
  context: ProgramContext,
  homeDirectory: string,
  token: InstallSsoTokenContext,
): Promise<CliResult> {
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
