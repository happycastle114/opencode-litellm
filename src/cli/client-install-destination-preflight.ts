import { resolveClaudeSettingsPath } from './claude-marketplace-asset'
import type { ClientInstallPathGuard } from './client-install-assets'
import {
  resolveCodexInstallDestinationPaths,
  type CodexInstallDestinationPaths,
} from './client-installer-codex-plan'
import {
  resolveOpenCodeInstallDestinationPaths,
  type OpenCodeInstallDestinationPaths,
} from './client-installer-opencode-plan'
import { InstallTarget, type InstallOptions } from './install-intent'
import {
  assertLaunchConfigPathWritable,
  resolveLaunchConfigPath,
} from './launch-config'
import {
  assertManagedRegularFileOrAbsent,
  readManagedFileSnapshot,
} from './managed-file-safety'
import {
  resolveOpenCodeConfigCandidatePaths,
  type PathEnv,
} from './paths'
import { resolveOhMyOpenAgentProfileCandidatePaths } from './qwen-routing'
import { resolveOpenCodeSkillDestination } from './skill-install'

export type ResolvedClientInstallDestinations = {
  readonly homeDirectory: string
  readonly sharedSkill: string
  readonly claudeSettings: string
  readonly launchConfig: string
  readonly guards: readonly ClientInstallPathGuard[]
  readonly openCode?: OpenCodeInstallDestinationPaths
  readonly codex?: CodexInstallDestinationPaths
}

export function resolveClientInstallDestinations(
  options: Pick<InstallOptions, 'target' | 'opencodeConfig' | 'codexConfig'>,
  env: PathEnv,
  homeDirectory: string,
): ResolvedClientInstallDestinations {
  const launchConfig = resolveLaunchConfigPath(env)
  assertLaunchConfigPathWritable(launchConfig)
  const openCode = includesTarget(options.target, InstallTarget.OpenCode)
    ? resolveOpenCodeInstallDestinationPaths(options, env)
    : undefined
  const codex = includesTarget(options.target, InstallTarget.Codex)
    ? resolveCodexInstallDestinationPaths(options, env, homeDirectory)
    : undefined
  return {
    homeDirectory,
    sharedSkill: resolveOpenCodeSkillDestination(homeDirectory),
    claudeSettings: resolveClaudeSettingsPath(homeDirectory),
    launchConfig,
    guards: openCode === undefined
      ? []
      : resolveOpenCodeSelectionGuards(options, env, openCode),
    ...(openCode === undefined ? {} : { openCode }),
    ...(codex === undefined ? {} : { codex }),
  }
}

export function assertClientInstallDestinationsSafe(
  destinations: ResolvedClientInstallDestinations,
): void {
  for (const path of selectedPaths(destinations)) {
    assertManagedRegularFileOrAbsent(path)
  }
}

function resolveOpenCodeSelectionGuards(
  options: Pick<InstallOptions, 'opencodeConfig'>,
  env: PathEnv,
  paths: OpenCodeInstallDestinationPaths,
): readonly ClientInstallPathGuard[] {
  const candidates = [
    ...resolveOpenCodeConfigCandidatePaths(options.opencodeConfig, env),
    ...resolveOhMyOpenAgentProfileCandidatePaths(paths.config),
  ]
  return [...new Set(candidates)]
    .filter((path): path is string => path !== undefined &&
      path !== paths.config && path !== paths.profile)
    .map((path) => ({
      path,
      expectation: { previous: readManagedFileSnapshot(path) },
    }))
}

function selectedPaths(
  destinations: ResolvedClientInstallDestinations,
): readonly string[] {
  const openCode = destinations.openCode === undefined
    ? []
    : [destinations.openCode.config, destinations.openCode.profile]
  const codex = destinations.codex === undefined
    ? []
    : Object.values(destinations.codex)
  return [
    ...openCode,
    ...codex,
    destinations.sharedSkill,
    destinations.claudeSettings,
    destinations.launchConfig,
  ]
}

function includesTarget(
  target: InstallTarget,
  selected: typeof InstallTarget.OpenCode | typeof InstallTarget.Codex,
): boolean {
  return target === InstallTarget.Both || target === selected
}
