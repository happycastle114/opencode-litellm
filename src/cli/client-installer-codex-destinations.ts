import { dirname, join } from 'node:path'
import { resolveCodexAuthHelperPath } from './auth-helper'
import type { PreparedInstall } from './install-preparation'
import {
  resolveCodexCatalogPath,
  resolveCodexConfigPath,
  type PathEnv,
} from './paths'

const MANAGED_FILE = {
  OAuthCatalog: 'litellm-codex-oauth-models.json',
  OAuthProfile: 'codex-oauth.config.toml',
} as const

export type CodexInstallDestinationPaths = {
  readonly config: string
  readonly gatewayCatalog: string
  readonly oauthCatalog: string
  readonly oauthProfile: string
  readonly helper: string
}

export function resolveCodexInstallDestinationPaths(
  options: Pick<PreparedInstall['options'], 'codexConfig'>,
  env: PathEnv,
  homeDirectory: string,
): CodexInstallDestinationPaths {
  const config = resolveCodexConfigPath(options.codexConfig, env)
  const directory = dirname(config)
  return {
    config,
    gatewayCatalog: resolveCodexCatalogPath(config),
    oauthCatalog: join(directory, MANAGED_FILE.OAuthCatalog),
    oauthProfile: join(directory, MANAGED_FILE.OAuthProfile),
    helper: resolveCodexAuthHelperPath(homeDirectory),
  }
}
