import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  installCodexAuthHelper,
  resolveCodexAuthHelperPath,
} from './auth-helper'
import {
  syncCodexOAuthEnvironment,
  type CodexEnvironmentBoundary,
} from './client-installer-codex-environment'
import {
  buildCodexCatalog,
  renderCodexConfig,
  renderCodexOAuthConfig,
} from './codex-config'
import {
  readBundledCodexCatalog,
  type BundledCodexCatalog,
} from './codex-discovery'
import { retireConfigFile, writeConfigAtomic } from './file-adapter'
import type { PreparedInstall } from './install-preparation'
import { CodexMode, InstallAuth } from './install-intent'
import {
  resolveCodexCatalogPath,
  resolveCodexConfigPath,
} from './paths'

const MANAGED_FILE = {
  OAuthCatalog: 'litellm-codex-oauth-models.json',
  OAuthProfile: 'codex-oauth.config.toml',
} as const
export type CodexClientInstallerBoundary = CodexEnvironmentBoundary & {
  readonly now: () => Date
  readonly bundledCodexCatalog?: () => BundledCodexCatalog
}

export type CodexClientInstallResult = {
  readonly path: string
  readonly warnings: readonly string[]
}

type CodexPaths = {
  readonly config: string
  readonly gatewayCatalog: string
  readonly oauthCatalog: string
  readonly oauthProfile: string
}

class CodexClientInstallerError extends Error {
  readonly name = 'CodexClientInstallerError'
}

export function installPreparedCodex(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): CodexClientInstallResult {
  const installed = installMode(prepared, boundary, homeDirectory)
  return {
    path: installed.path,
    warnings: [
      ...installed.warnings,
      ...syncCodexOAuthEnvironment(prepared, boundary, homeDirectory),
    ],
  }
}

function installMode(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): CodexClientInstallResult {
  switch (prepared.options.codexMode) {
    case CodexMode.Gateway:
      return installGateway(prepared, boundary, homeDirectory)
    case CodexMode.OAuth:
      return installOAuth(prepared, boundary, homeDirectory)
    case CodexMode.Both:
      return installBoth(prepared, boundary, homeDirectory)
    default:
      return assertNever(prepared.options.codexMode)
  }
}

function installGateway(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): CodexClientInstallResult {
  const paths = codexPaths(prepared, boundary)
  const catalog = buildCodexCatalog(prepared.discovery.models)
  const helperPath = resolveCodexAuthHelperPath(homeDirectory)
  const output = renderCodexConfig(readSource(paths.config), {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    ...gatewayAuth(prepared.options.auth, helperPath),
    catalogPath: paths.gatewayCatalog,
    defaultModel: catalog.defaultModel,
    ...selectedResources(prepared),
    includeOAuthProvider: false,
  })
  installHelper(prepared, boundary, homeDirectory)
  writeConfigAtomic(paths.gatewayCatalog, catalog.json, { now: boundary.now })
  writeConfigAtomic(paths.config, output, { now: boundary.now })
  retireConfigFile(paths.oauthProfile, { now: boundary.now })
  retireConfigFile(paths.oauthCatalog, { now: boundary.now })
  return { path: paths.config, warnings: [] }
}

function installOAuth(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): CodexClientInstallResult {
  const paths = codexPaths(prepared, boundary)
  const bundled = loadBundledCatalog(boundary)
  const output = renderCodexOAuthConfig(
    readSource(paths.config),
    oauthIntent(prepared, bundled, paths.oauthCatalog),
  )
  installHelper(prepared, boundary, homeDirectory)
  writeConfigAtomic(paths.oauthCatalog, bundled.json, { now: boundary.now })
  writeConfigAtomic(paths.config, output, { now: boundary.now })
  retireConfigFile(paths.gatewayCatalog, { now: boundary.now })
  retireConfigFile(paths.oauthProfile, { now: boundary.now })
  return { path: paths.config, warnings: [] }
}

function installBoth(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): CodexClientInstallResult {
  const paths = codexPaths(prepared, boundary)
  const gatewayCatalog = buildCodexCatalog(prepared.discovery.models)
  const bundled = loadBundledCatalog(boundary)
  const helperPath = resolveCodexAuthHelperPath(homeDirectory)
  const mainOutput = renderCodexConfig(readSource(paths.config), {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    ...gatewayAuth(prepared.options.auth, helperPath),
    catalogPath: paths.gatewayCatalog,
    defaultModel: gatewayCatalog.defaultModel,
    ...selectedResources(prepared),
    includeOAuthProvider: false,
  })
  const oauthOutput = renderCodexOAuthConfig(
    readSource(paths.oauthProfile),
    oauthIntent(prepared, bundled, paths.oauthCatalog),
  )
  installHelper(prepared, boundary, homeDirectory)
  writeConfigAtomic(paths.gatewayCatalog, gatewayCatalog.json, { now: boundary.now })
  writeConfigAtomic(paths.oauthCatalog, bundled.json, { now: boundary.now })
  writeConfigAtomic(paths.config, mainOutput, { now: boundary.now })
  writeConfigAtomic(paths.oauthProfile, oauthOutput, { now: boundary.now })
  return { path: paths.config, warnings: [] }
}

function codexPaths(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
): CodexPaths {
  const config = resolveCodexConfigPath(prepared.options.codexConfig, boundary.env)
  const directory = dirname(config)
  return {
    config,
    gatewayCatalog: resolveCodexCatalogPath(config),
    oauthCatalog: join(directory, MANAGED_FILE.OAuthCatalog),
    oauthProfile: join(directory, MANAGED_FILE.OAuthProfile),
  }
}

function selectedResources(prepared: PreparedInstall) {
  return {
    mcp: prepared.options.mcp,
    toolsets: prepared.options.toolsets,
    disableMcp: prepared.options.disableMcp,
  }
}

function oauthIntent(
  prepared: PreparedInstall,
  catalog: BundledCodexCatalog,
  catalogPath: string,
) {
  return {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    catalogPath,
    ...(catalog.defaultModel === undefined ? {} : { defaultModel: catalog.defaultModel }),
    ...selectedResources(prepared),
  }
}

function installHelper(
  prepared: PreparedInstall,
  boundary: CodexClientInstallerBoundary,
  homeDirectory: string,
): void {
  installCodexAuthHelper({
    homeDirectory,
    gatewayOrigin: prepared.options.baseUrl,
    now: boundary.now,
  })
}

function loadBundledCatalog(boundary: CodexClientInstallerBoundary): BundledCodexCatalog {
  if (boundary.bundledCodexCatalog !== undefined) return boundary.bundledCodexCatalog()
  return boundary.codexSpawnBoundary === undefined
    ? readBundledCodexCatalog()
    : readBundledCodexCatalog(boundary.codexSpawnBoundary)
}

function gatewayAuth(
  auth: PreparedInstall['options']['auth'],
  helperPath: string,
): { readonly authCommand?: string } {
  switch (auth) {
    case InstallAuth.Environment:
      return {}
    case InstallAuth.Sso:
      return { authCommand: helperPath }
    default:
      return assertNever(auth)
  }
}

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function assertNever(value: never): never {
  throw new CodexClientInstallerError('Codex installation reached an unsupported typed variant.')
}
