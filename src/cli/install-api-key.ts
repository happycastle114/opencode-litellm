import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
  type ClientInstallExpectation,
} from './client-install-assets'
import type { PreparedInstall } from './install-preparation'
import { readManagedFileSnapshot } from './managed-file-safety'
import { resolveManualLiteLLMApiKeyPath } from './official-token'
import type { PathEnv } from './paths'

const API_KEY_FILE_MODE = 0o600

export type InstallApiKeyContext = {
  readonly path: string
  readonly expectation: ClientInstallExpectation
}

export function createInstallApiKeyContext(env: PathEnv): InstallApiKeyContext {
  const path = resolveManualLiteLLMApiKeyPath(env)
  return { path, expectation: { previous: readManagedFileSnapshot(path) } }
}

export function planInstallApiKeyAsset(
  prepared: PreparedInstall,
  context: InstallApiKeyContext,
): ClientInstallAssetPlan | undefined {
  if (prepared.deferredApiKey === undefined) return undefined
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path: context.path,
    contents: prepared.deferredApiKey.contents,
    mode: API_KEY_FILE_MODE,
    backup: CLIENT_INSTALL_BACKUP_POLICY.None,
    expectation: context.expectation,
  }
}
