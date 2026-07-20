import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  installPreparedCodex,
  type CodexClientInstallerBoundary,
} from './client-installer-codex'
import { writeConfigAtomic } from './file-adapter'
import {
  type InstallSelectionWarning,
  type PreparedInstall,
} from './install-preparation'
import { InstallTarget } from './install-intent'
import type { GatewayDiscoveryWarning } from './gateway-tool-discovery'
import {
  ensureManagedOpenCodePlugin,
  planManagedOpenCodePlugin,
  type ManagedPluginBoundary,
} from './managed-plugin'
import { applyOpenCodeEdits, planOpenCodeEdits } from './opencode-config'
import {
  PathResolutionError,
  resolveOpenCodeConfigPath,
  type PathEnv,
} from './paths'
import { installOpenCodeSkill } from './skill-install'

export type ClientInstallerBoundary = CodexClientInstallerBoundary & {
  readonly managedPluginBoundary?: ManagedPluginBoundary
}

export type ClientConfiguredPath = {
  readonly client: typeof InstallTarget.OpenCode | typeof InstallTarget.Codex
  readonly path: string
}

export type ClientInstallResult = {
  readonly configured: readonly ClientConfiguredPath[]
  readonly warnings: readonly string[]
}

export class ClientInstallerError extends Error {
  readonly name = 'ClientInstallerError'
}

export async function installPreparedClients(
  prepared: PreparedInstall,
  boundary: ClientInstallerBoundary,
): Promise<ClientInstallResult> {
  const homeDirectory = resolveHome(boundary.env)
  const preparedWarnings = formatPreparedWarnings(prepared)
  switch (prepared.options.target) {
    case InstallTarget.OpenCode: {
      const path = await installOpenCode(prepared, boundary)
      installOpenCodeSkill({ homeDirectory })
      return {
        configured: [{ client: InstallTarget.OpenCode, path }],
        warnings: preparedWarnings,
      }
    }
    case InstallTarget.Codex: {
      const codex = installPreparedCodex(prepared, boundary, homeDirectory)
      installOpenCodeSkill({ homeDirectory })
      return {
        configured: [{ client: InstallTarget.Codex, path: codex.path }],
        warnings: [...preparedWarnings, ...codex.warnings],
      }
    }
    case InstallTarget.Both: {
      const openCodePath = await installOpenCode(prepared, boundary)
      const codex = installPreparedCodex(prepared, boundary, homeDirectory)
      installOpenCodeSkill({ homeDirectory })
      return {
        configured: [
          { client: InstallTarget.OpenCode, path: openCodePath },
          { client: InstallTarget.Codex, path: codex.path },
        ],
        warnings: [...preparedWarnings, ...codex.warnings],
      }
    }
    default:
      return assertNever(prepared.options.target)
  }
}

function formatPreparedWarnings(prepared: PreparedInstall): readonly string[] {
  return [
    ...prepared.selectionWarnings.map(formatSelectionWarning),
    ...prepared.discovery.warnings.map(formatGatewayWarning),
  ]
}

function formatSelectionWarning(warning: InstallSelectionWarning): string {
  return `Selected ${warning.resource} '${warning.name}' is not visible to this gateway identity and was skipped.`
}

function formatGatewayWarning(warning: GatewayDiscoveryWarning): string {
  const httpStatus = warning.status === undefined ? '' : ` (HTTP ${warning.status})`
  return `Gateway ${warning.resource} discovery ${warning.kind} at ${warning.endpoint}${httpStatus}; continuing with available resources.`
}

async function installOpenCode(
  prepared: PreparedInstall,
  boundary: ClientInstallerBoundary,
): Promise<string> {
  const path = resolveOpenCodeConfigPath(prepared.options.opencodeConfig, boundary.env)
  const managedPlan = planManagedOpenCodePlugin({ opencodeConfigDir: dirname(path) })
  if (boundary.externalSetup === true) {
    await ensureManagedOpenCodePlugin(managedPlan, boundary.managedPluginBoundary)
  }
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '{}\n'
  const output = applyOpenCodeEdits(source, planOpenCodeEdits(source, {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    pluginSpec: managedPlan.pluginSpec,
    mcpDiscoveryEnabled: !prepared.options.noMcp,
    search: prepared.options.search,
    mcp: prepared.options.mcp,
    toolsets: prepared.options.toolsets,
    disableMcp: prepared.options.disableMcp,
  }, path))
  writeConfigAtomic(path, output, { now: boundary.now })
  return path
}

function resolveHome(env: PathEnv): string {
  if (env.HOME !== undefined && env.HOME !== '') return env.HOME
  throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
}

function assertNever(value: never): never {
  throw new ClientInstallerError('Client installation reached an unsupported typed variant.')
}
