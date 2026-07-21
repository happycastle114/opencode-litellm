import { readFileSync } from 'node:fs'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
} from './client-install-assets'
import {
  abortClientInstallTransaction,
  type ClientInstallCommitBoundary,
  type StagedClientInstallTransaction,
} from './client-install-transaction'
import { stageAndCommitClientInstallTransactionWithLeases } from './client-install-transaction-lease'
import {
  resolveClientInstallDestinations,
  type ResolvedClientInstallDestinations,
} from './client-install-destination-preflight'
import {
  findClientInstallRecoveryFiles,
  formatClientInstallRecoveryWarning,
} from './client-install-recovery'
import {
  completePreparedCodex,
  prepareCodexInstall,
  type CodexClientInstallerBoundary,
  type CodexInstallPlan,
} from './client-installer-codex'
import {
  prepareOpenCodeInstall,
  type OpenCodeInstallPlan,
} from './client-installer-opencode-plan'
import { formatPreparedInstallWarnings } from './client-installer-warnings'
import type { PreparedInstall } from './install-preparation'
import { InstallTarget } from './install-intent'
import {
  activateManagedOpenCodePlugin,
  completeManagedOpenCodePluginActivation,
  rollbackManagedOpenCodePluginActivation,
  type ManagedOpenCodePluginActivation,
  type ManagedOpenCodePluginPlan,
  type ManagedPluginBoundary,
} from './managed-plugin'
import { PathResolutionError, type PathEnv } from './paths'
import { readManagedFileSnapshot } from './managed-file-safety'
import { resolvePackagedSkillSourcePath, SHARED_LITELLM_SKILL_MODE } from './skill-install'

export type ClientInstallerBoundary = CodexClientInstallerBoundary & {
  readonly managedPluginBoundary?: ManagedPluginBoundary
  readonly clientInstallCommitBoundary?: ClientInstallCommitBoundary
}

export type ClientConfiguredPath = {
  readonly client: typeof InstallTarget.OpenCode | typeof InstallTarget.Codex
  readonly path: string
}

export type ClientInstallResult = {
  readonly configured: readonly ClientConfiguredPath[]
  readonly warnings: readonly string[]
}

type ClientTransactionPlan = {
  readonly assets: readonly ClientInstallAssetPlan[]
  readonly configured: readonly ClientConfiguredPath[]
  readonly warnings: readonly string[]
  readonly managedPlugin?: ManagedOpenCodePluginPlan
  readonly codex?: CodexInstallPlan
}

export class ClientInstallerError extends Error {
  readonly name = 'ClientInstallerError'
}

export async function installPreparedClients(
  prepared: PreparedInstall,
  boundary: ClientInstallerBoundary,
  additionalAssets: readonly ClientInstallAssetPlan[] = [],
  destinations?: ResolvedClientInstallDestinations,
): Promise<ClientInstallResult> {
  const homeDirectory = resolveHome(boundary.env)
  const resolved = destinations ?? resolveClientInstallDestinations(
    prepared.options,
    boundary.env,
    homeDirectory,
  )
  const plan = prepareClientTransaction(
    prepared,
    boundary,
    resolved,
    additionalAssets,
  )
  let activation: ManagedOpenCodePluginActivation | undefined
  let transaction: StagedClientInstallTransaction | undefined
  let destinationLeaseWarnings: readonly string[] = []
  try {
    activation = await activateManagedPlugin(plan.managedPlugin, boundary)
    const committed = await stageAndCommitClientInstallTransactionWithLeases({
      assets: plan.assets,
      guards: resolved.guards,
      now: boundary.now,
      ...(boundary.clientInstallCommitBoundary === undefined
        ? {}
        : { commitBoundary: boundary.clientInstallCommitBoundary }),
    })
    transaction = committed.transaction
    destinationLeaseWarnings = committed.warnings
    if (activation !== undefined) completeManagedOpenCodePluginActivation(activation)
  } catch (error) {
    if (transaction !== undefined) abortClientInstallTransaction(transaction)
    if (activation !== undefined) {
      rollbackManagedOpenCodePluginActivation(
        activation,
        boundary.managedPluginBoundary,
      )
    }
    throw error
  }
  const codexWarnings = plan.codex === undefined
    ? []
    : completePreparedCodex(plan.codex, prepared, boundary).warnings
  return {
    configured: plan.configured,
    warnings: [
      ...plan.warnings,
      ...destinationLeaseWarnings,
      ...codexWarnings,
      ...findClientInstallRecoveryFiles(plan.assets).map(
        formatClientInstallRecoveryWarning,
      ),
    ],
  }
}

function prepareClientTransaction(
  prepared: PreparedInstall,
  boundary: ClientInstallerBoundary,
  destinations: ResolvedClientInstallDestinations,
  additionalAssets: readonly ClientInstallAssetPlan[],
): ClientTransactionPlan {
  const skill = prepareSharedSkillAsset(destinations.sharedSkill)
  const preparedWarnings = formatPreparedInstallWarnings(prepared)
  switch (prepared.options.target) {
    case InstallTarget.OpenCode: {
      const openCode = prepareOpenCodeInstall(
        prepared,
        boundary,
        requiredOpenCodeDestinations(destinations),
      )
      return openCodeTransaction(openCode, skill, additionalAssets, preparedWarnings)
    }
    case InstallTarget.Codex: {
      const codex = prepareCodexInstall(
        prepared,
        boundary,
        destinations.homeDirectory,
        requiredCodexDestinations(destinations),
      )
      return codexTransaction(codex, skill, additionalAssets, preparedWarnings)
    }
    case InstallTarget.Both: {
      const codex = prepareCodexInstall(
        prepared,
        boundary,
        destinations.homeDirectory,
        requiredCodexDestinations(destinations),
      )
      const openCode = prepareOpenCodeInstall(
        prepared,
        boundary,
        requiredOpenCodeDestinations(destinations),
      )
      return {
        assets: [...openCode.assets, ...codex.assets, skill, ...additionalAssets],
        configured: [
          { client: InstallTarget.OpenCode, path: openCode.path },
          { client: InstallTarget.Codex, path: codex.path },
        ],
        warnings: [...preparedWarnings, ...openCode.warnings],
        managedPlugin: openCode.managedPlugin,
        codex,
      }
    }
    default:
      return assertNever(prepared.options.target)
  }
}

function openCodeTransaction(
  plan: OpenCodeInstallPlan,
  skill: ClientInstallAssetPlan,
  additional: readonly ClientInstallAssetPlan[],
  warnings: readonly string[],
): ClientTransactionPlan {
  return {
    assets: [...plan.assets, skill, ...additional],
    configured: [{ client: InstallTarget.OpenCode, path: plan.path }],
    warnings: [...warnings, ...plan.warnings],
    managedPlugin: plan.managedPlugin,
  }
}

function codexTransaction(
  plan: CodexInstallPlan,
  skill: ClientInstallAssetPlan,
  additional: readonly ClientInstallAssetPlan[],
  warnings: readonly string[],
): ClientTransactionPlan {
  return {
    assets: [...plan.assets, skill, ...additional],
    configured: [{ client: InstallTarget.Codex, path: plan.path }],
    warnings,
    codex: plan,
  }
}

function prepareSharedSkillAsset(path: string): ClientInstallAssetPlan {
  const sourcePath = resolvePackagedSkillSourcePath()
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path,
    contents: readFileSync(sourcePath, 'utf8'),
    mode: SHARED_LITELLM_SKILL_MODE,
    backup: CLIENT_INSTALL_BACKUP_POLICY.None,
    expectation: { previous: readManagedFileSnapshot(path) },
  }
}

function requiredOpenCodeDestinations(
  destinations: ResolvedClientInstallDestinations,
): NonNullable<ResolvedClientInstallDestinations['openCode']> {
  if (destinations.openCode !== undefined) return destinations.openCode
  throw new ClientInstallerError('Resolved OpenCode destinations are missing.')
}

function requiredCodexDestinations(
  destinations: ResolvedClientInstallDestinations,
): NonNullable<ResolvedClientInstallDestinations['codex']> {
  if (destinations.codex !== undefined) return destinations.codex
  throw new ClientInstallerError('Resolved Codex destinations are missing.')
}

async function activateManagedPlugin(
  plan: ManagedOpenCodePluginPlan | undefined,
  boundary: ClientInstallerBoundary,
): Promise<ManagedOpenCodePluginActivation | undefined> {
  if (plan === undefined || boundary.externalSetup !== true) return undefined
  return activateManagedOpenCodePlugin(plan, boundary.managedPluginBoundary)
}

function resolveHome(env: PathEnv): string {
  if (env.HOME !== undefined && env.HOME !== '') return env.HOME
  throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
}

function assertNever(value: never): never {
  throw new ClientInstallerError('Client installation reached an unsupported typed variant.')
}
