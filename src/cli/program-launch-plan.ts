import {
  InstallAuth,
  InstallTarget,
  type CodexMode,
  type InstallOptions,
} from './install-intent'
import {
  LaunchConfigSchemaVersion,
  type ClaudeLaunchState,
  type CodexLaunchState,
  type LaunchConfig,
  type OpenCodeLaunchState,
} from './launch-config'
import type { ResolvedClientInstallDestinations } from './client-install-destination-preflight'

export type PreparedLaunchOptions = InstallOptions & {
  readonly baseUrl: string
  readonly authEnv: string
}

export type LaunchConfigPlan = {
  readonly config: LaunchConfig
  readonly warnings: readonly string[]
}

export function buildLaunchConfig(
  previous: LaunchConfig | undefined,
  options: PreparedLaunchOptions,
  destinations: ResolvedClientInstallDestinations,
): LaunchConfigPlan {
  const next: {
    schemaVersion: typeof LaunchConfigSchemaVersion
    openCode?: OpenCodeLaunchState
    codex?: CodexLaunchState
    claude: ClaudeLaunchState
  } = {
    schemaVersion: LaunchConfigSchemaVersion,
    claude: {
      gatewayOrigin: options.baseUrl,
      auth: options.auth,
      authEnv: options.authEnv,
    },
  }

  if (previous?.openCode !== undefined) next.openCode = previous.openCode
  if (previous?.codex !== undefined) next.codex = previous.codex

  if (options.target === InstallTarget.OpenCode || options.target === InstallTarget.Both) {
    next.openCode = {
      gatewayOrigin: options.baseUrl,
      auth: options.auth,
      authEnv: options.authEnv,
      configPath: requiredOpenCodeConfigPath(destinations),
    }
  }
  if (options.target === InstallTarget.Codex || options.target === InstallTarget.Both) {
    next.codex = {
      gatewayOrigin: options.baseUrl,
      auth: options.auth,
      authEnv: options.authEnv,
      configPath: requiredCodexConfigPath(destinations),
      codexMode: options.codexMode,
    }
  }
  return {
    config: next,
    warnings: retireConflictingSsoStates(previous, next, options),
  }
}

function requiredOpenCodeConfigPath(
  destinations: ResolvedClientInstallDestinations,
): string {
  if (destinations.openCode !== undefined) return destinations.openCode.config
  throw new Error('Resolved OpenCode configuration path is missing.')
}

function requiredCodexConfigPath(
  destinations: ResolvedClientInstallDestinations,
): string {
  if (destinations.codex !== undefined) return destinations.codex.config
  throw new Error('Resolved Codex configuration path is missing.')
}

function retireConflictingSsoStates(
  previous: LaunchConfig | undefined,
  next: {
    openCode?: OpenCodeLaunchState
    codex?: CodexLaunchState
  },
  options: PreparedLaunchOptions,
): readonly string[] {
  if (previous === undefined || options.auth !== InstallAuth.Sso) return []
  const warnings: string[] = []
  if (
    !targetIncludes(options.target, InstallTarget.OpenCode) &&
    previous.openCode?.auth === InstallAuth.Sso &&
    previous.openCode.gatewayOrigin !== options.baseUrl
  ) {
    delete next.openCode
    warnings.push(retiredSsoWarning(
      'OpenCode',
      'opencode-litellm',
      previous.openCode.gatewayOrigin,
      options.baseUrl,
    ))
  }
  if (
    !targetIncludes(options.target, InstallTarget.Codex) &&
    previous.codex?.auth === InstallAuth.Sso &&
    previous.codex.gatewayOrigin !== options.baseUrl
  ) {
    delete next.codex
    warnings.push(retiredSsoWarning(
      'Codex',
      'codex-litellm',
      previous.codex.gatewayOrigin,
      options.baseUrl,
    ))
  }
  return warnings
}

function targetIncludes(
  target: InstallTarget,
  client: typeof InstallTarget.OpenCode | typeof InstallTarget.Codex,
): boolean {
  return target === InstallTarget.Both || target === client
}

function retiredSsoWarning(
  launcher: 'OpenCode' | 'Codex',
  binary: string,
  previousOrigin: string,
  activeOrigin: string,
): string {
  return `Retired previous ${launcher} SSO launch state for ${previousOrigin} because this install uses ${activeOrigin}; run '${binary} install --target ${launcher.toLowerCase()} --base-url ${activeOrigin} --auth sso' to reconfigure ${launcher} for the active SSO token.`
}
