import {
  syncCodexSessionEnvironment,
  type CodexEnvironmentBoundary,
} from './client-installer-codex-environment'
import {
  prepareCodexInstall as prepareCodexInstallPlan,
  type CodexInstallDestinationPaths,
  type CodexInstallPlan,
} from './client-installer-codex-plan'
import type { BundledCodexCatalog } from './codex-discovery'
import type { PreparedInstall } from './install-preparation'

export type CodexClientInstallerBoundary = CodexEnvironmentBoundary & {
  readonly now: () => Date
  readonly bundledCodexCatalog?: () => BundledCodexCatalog
}

export type CodexClientInstallResult = {
  readonly path: string
  readonly warnings: readonly string[]
}

export type { CodexInstallPlan }

export function prepareCodexInstall(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
  destinations?: CodexInstallDestinationPaths,
): CodexInstallPlan {
  return prepareCodexInstallPlan(prepared, boundary, homeDirectory, destinations)
}

export function completePreparedCodex(
  plan: CodexInstallPlan,
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
): CodexClientInstallResult {
  return {
    path: plan.path,
    warnings: plan.sessionEnvironmentRequired
      ? syncCodexSessionEnvironment(
          prepared.options.authEnv,
          boundary,
          plan.homeDirectory,
        )
      : [],
  }
}
