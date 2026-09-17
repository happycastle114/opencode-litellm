import { CODEX_NATIVE_TOKEN_COMMAND } from './codex-config-blocks'
import { loadEnvKey, resolveManualLiteLLMApiKeyPath } from './official-token'
import {
  CODEX_AUTH_HELPER_MODE,
  renderCodexAuthHelperSource,
} from './auth-helper'
import {
  createCodexManagedWriteAsset,
  createCodexRetireAsset,
  createCodexWriteAsset,
  readCodexSource,
} from './client-installer-codex-assets'
import {
  resolveCodexInstallDestinationPaths as resolveCodexInstallDestinations,
  type CodexInstallDestinationPaths,
} from './client-installer-codex-destinations'
import type { ClientInstallAssetPlan } from './client-install-assets'
import {
  buildCodexCatalog,
  renderCodexConfig,
  renderCodexOAuthConfig,
} from './codex-config'
import {
  assertBundledCodexOAuthCatalog,
  createCodexSpawnBoundary,
  readBundledCodexCatalog,
  type BundledCodexCatalog,
  type CodexSpawnBoundary,
} from './codex-discovery'
import type { PreparedInstall } from './install-preparation'
import { CodexMode, InstallAuth } from './install-intent'
import type { PathEnv } from './paths'

export type { CodexInstallDestinationPaths } from './client-installer-codex-destinations'
export { resolveCodexInstallDestinationPaths } from './client-installer-codex-destinations'

export type CodexInstallPlanningBoundary = {
  readonly env: PathEnv
  readonly bundledCodexCatalog?: () => BundledCodexCatalog
  readonly codexSpawnBoundary?: CodexSpawnBoundary
}

export type CodexInstallPlan = {
  readonly path: string
  readonly assets: readonly ClientInstallAssetPlan[]
}

class CodexInstallPlanningError extends Error {
  readonly name = 'CodexInstallPlanningError'
}

export function prepareCodexInstall(
  prepared: PreparedInstall,
  boundary: CodexInstallPlanningBoundary,
  homeDirectory: string,
  destinations: CodexInstallDestinationPaths =
    resolveCodexInstallDestinations(prepared.options, boundary.env, homeDirectory),
): CodexInstallPlan {
  const paths = destinations
  const helperPath = paths.helper
  const apiKeyFilePath = resolveManualLiteLLMApiKeyPath({ ...boundary.env, HOME: homeDirectory })
  const usesManualKey = prepared.options.auth === InstallAuth.Environment &&
    (prepared.deferredApiKey !== undefined || loadEnvKey(apiKeyFilePath, prepared.options.baseUrl) === prepared.apiKey)
  const helperAsset = usesManualKey && prepared.options.codexMode !== CodexMode.OAuth
    ? createCodexManagedWriteAsset(
        helperPath,
        renderCodexAuthHelperSource(prepared.options.baseUrl, apiKeyFilePath),
        CODEX_AUTH_HELPER_MODE,
      )
    : createCodexRetireAsset(helperPath)
  const auth = gatewayAuth(prepared.options.auth, prepared.options.baseUrl, helperPath, usesManualKey)
  const common = {
    path: paths.config,
  } as const

  switch (prepared.options.codexMode) {
    case CodexMode.Gateway: {
      const bundled = loadBundledCatalog(boundary)
      const catalog = buildCodexCatalog(prepared.discovery.models, bundled, prepared.defaultModel)
      const configSource = readCodexSource(paths.config)
      const output = renderGatewayConfig(
        configSource.contents,
        prepared,
        auth,
        paths.gatewayCatalog,
        catalog.defaultModel,
      )
      return {
        ...common,
        assets: [
          helperAsset,
          createCodexWriteAsset(paths.gatewayCatalog, catalog.json),
          createCodexWriteAsset(paths.config, output, configSource.expectation),
          createCodexRetireAsset(paths.oauthProfile),
          createCodexRetireAsset(paths.oauthCatalog),
        ],
      }
    }
    case CodexMode.OAuth: {
      const bundled = loadBundledCatalog(boundary)
      assertBundledCodexOAuthCatalog(bundled)
      const configSource = readCodexSource(paths.config)
      const output = renderCodexOAuthConfig(
        configSource.contents,
        oauthIntent(prepared, bundled, paths.oauthCatalog),
      )
      return {
        ...common,
        assets: [
          helperAsset,
          createCodexWriteAsset(paths.oauthCatalog, bundled.json),
          createCodexWriteAsset(paths.config, output, configSource.expectation),
          createCodexRetireAsset(paths.gatewayCatalog),
          createCodexRetireAsset(paths.oauthProfile),
        ],
      }
    }
    case CodexMode.Both: {
      const bundled = loadBundledCatalog(boundary)
      assertBundledCodexOAuthCatalog(bundled)
      const gatewayCatalog = buildCodexCatalog(prepared.discovery.models, bundled, prepared.defaultModel)
      const configSource = readCodexSource(paths.config)
      const profileSource = readCodexSource(paths.oauthProfile)
      const mainOutput = renderGatewayConfig(
        configSource.contents,
        prepared,
        auth,
        paths.gatewayCatalog,
        gatewayCatalog.defaultModel,
      )
      const oauthOutput = renderCodexOAuthConfig(
        profileSource.contents,
        oauthIntent(prepared, bundled, paths.oauthCatalog),
      )
      return {
        ...common,
        assets: [
          helperAsset,
          createCodexWriteAsset(paths.gatewayCatalog, gatewayCatalog.json),
          createCodexWriteAsset(paths.oauthCatalog, bundled.json),
          createCodexWriteAsset(paths.config, mainOutput, configSource.expectation),
          createCodexWriteAsset(paths.oauthProfile, oauthOutput, profileSource.expectation),
        ],
      }
    }
    default:
      return assertNever(prepared.options.codexMode)
  }
}

function renderGatewayConfig(
  source: string,
  prepared: PreparedInstall,
  auth: ReturnType<typeof gatewayAuth>,
  catalogPath: string,
  defaultModel: string,
): string {
  return renderCodexConfig(source, {
    baseUrl: prepared.options.baseUrl,
    authEnv: prepared.options.authEnv,
    ...auth,
    catalogPath,
    defaultModel,
    ...selectedResources(prepared),
    includeOAuthProvider: false,
  })
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
    defaultModel: catalog.defaultModel,
    ...selectedResources(prepared),
  }
}

function selectedResources(prepared: PreparedInstall) {
  return {
    mcp: prepared.options.mcp,
    toolsets: prepared.options.toolsets,
    disableMcp: prepared.options.disableMcp,
  }
}

function loadBundledCatalog(
  boundary: CodexInstallPlanningBoundary,
): BundledCodexCatalog {
  if (boundary.bundledCodexCatalog !== undefined) return boundary.bundledCodexCatalog()
  return readBundledCodexCatalog(boundary.codexSpawnBoundary ?? createCodexSpawnBoundary())
}

function gatewayAuth(
  auth: PreparedInstall['options']['auth'],
  origin: string,
  helperPath: string,
  usesManualKey: boolean,
): { readonly authCommand?: string; readonly authArgs?: readonly string[] } {
  switch (auth) {
    case InstallAuth.Sso:
      return { authCommand: CODEX_NATIVE_TOKEN_COMMAND, authArgs: ['--base-url', origin, 'auth', 'print-token'] }
    case InstallAuth.Environment:
      return usesManualKey ? { authCommand: helperPath } : {}
    default:
      return assertNever(auth)
  }
}

function assertNever(value: never): never {
  throw new CodexInstallPlanningError(
    `Codex install planning reached an unsupported typed variant: ${String(value)}`,
  )
}
