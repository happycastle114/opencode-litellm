import { renderOmoPolicy } from '../omo/profile'
import { dirname } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  type ClientInstallExpectation,
  type ClientInstallAssetPlan,
} from './client-install-assets'
import type { ClientInstallerBoundary } from './client-installer'
import type { PreparedInstall } from './install-preparation'
import { readManagedFileSnapshot } from './managed-file-safety'
import {
  planManagedOpenCodePlugin,
  type ManagedOpenCodePluginPlan,
} from './managed-plugin'
import { applyOpenCodeEdits, planOpenCodeEdits } from './opencode-config'
import { resolveOpenCodeConfigPath } from './paths'
import type { PathEnv } from './paths'
import {
  renderOhMyOpenAgentProfile,
  resolveOhMyOpenAgentProfilePath,
} from './qwen-routing'

const OPENAGENT_PROFILE_MODE = 0o600

export type OpenCodeInstallPlan = {
  readonly path: string
  readonly assets: readonly ClientInstallAssetPlan[]
  readonly managedPlugin: ManagedOpenCodePluginPlan
  readonly warnings: readonly string[]
}

export type OpenCodeInstallDestinationPaths = {
  readonly config: string
  readonly profile: string
}

export function prepareOpenCodeInstall(
  prepared: PreparedInstall,
  boundary: ClientInstallerBoundary,
  destinations: OpenCodeInstallDestinationPaths =
    resolveOpenCodeInstallDestinationPaths(prepared.options, boundary.env),
): OpenCodeInstallPlan {
  const path = destinations.config
  const managedPlugin = planManagedOpenCodePlugin({ opencodeConfigDir: dirname(path) })
  const plannedSource = readPlannedSource(path, '{}\n')
  const source = plannedSource.contents
  const output = applyOpenCodeEdits(source, planOpenCodeEdits(source, {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    models: prepared.discovery.models,
    pluginSpec: managedPlugin.pluginSpec,
    mcpDiscoveryEnabled: !prepared.options.noMcp,
    search: prepared.options.search,
    mcp: prepared.options.mcp,
    toolsets: prepared.options.toolsets,
    disableMcp: prepared.options.disableMcp,
  }, path))
  const profilePath = destinations.profile
  const plannedProfile = readPlannedSource(profilePath, '{}\n')
  const profileSource = plannedProfile.contents
  const baseProfile = renderOhMyOpenAgentProfile(profileSource, { qwenRoutingEnabled: false }, profilePath)
  const profileOutput = prepared.discovery.omoPolicy === undefined
    ? baseProfile
    : renderOmoPolicy(baseProfile, prepared.discovery.omoPolicy)
  return {
    path,
    managedPlugin,
    assets: [
      {
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path,
        contents: output,
        expectation: plannedSource.expectation,
      },
      {
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path: profilePath,
        contents: profileOutput,
        mode: OPENAGENT_PROFILE_MODE,
        expectation: plannedProfile.expectation,
      },
    ],
    warnings: [],
  }
}

function readPlannedSource(path: string, absent: string): {
  readonly contents: string
  readonly expectation: ClientInstallExpectation
} {
  const previous = readManagedFileSnapshot(path)
  return {
    contents: previous?.contents.toString('utf8') ?? absent,
    expectation: { previous },
  }
}

export function resolveOpenCodeInstallDestinationPaths(
  options: Pick<PreparedInstall['options'], 'opencodeConfig'>,
  env: PathEnv,
): OpenCodeInstallDestinationPaths {
  const config = resolveOpenCodeConfigPath(options.opencodeConfig, env)
  return { config, profile: resolveOhMyOpenAgentProfilePath(config) }
}
