import type { CodexEnvironmentBoundary } from './client-installer-codex-environment'
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

export type { CodexInstallPlan }

export function prepareCodexInstall(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
  destinations?: CodexInstallDestinationPaths,
): CodexInstallPlan {
  return prepareCodexInstallPlan(prepared, boundary, homeDirectory, destinations)
}
