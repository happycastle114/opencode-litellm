import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
  type ClientInstallExpectation,
} from './client-install-assets'
import type { InstallPreparationBoundary, PreparedInstall } from './install-preparation'
import { readManagedFileSnapshot } from './managed-file-safety'

const TOKEN_PATH = ['.litellm', 'token.json'] as const
const TOKEN_FILE_MODE = 0o600

export type InstallSsoTokenContext = {
  readonly path: string
  readonly expectation: ClientInstallExpectation
  readonly onboard?: InstallPreparationBoundary['onboard']
  readonly cleanup: () => void
}

export function createInstallSsoTokenContext(
  homeDirectory: string,
  onboard: InstallPreparationBoundary['onboard'] | undefined,
): InstallSsoTokenContext {
  const path = join(homeDirectory, ...TOKEN_PATH)
  const expectation = { previous: readManagedFileSnapshot(path) }
  if (onboard === undefined) return { path, expectation, cleanup: () => undefined }

  let temporaryDirectory: string | undefined
  const deferredOnboard: InstallPreparationBoundary['onboard'] = async (input) => {
    temporaryDirectory ??= mkdtempSync(join(tmpdir(), 'opencode-litellm-sso-'))
    const temporaryTokenPath = join(temporaryDirectory, 'token.json')
    const result = await onboard({ ...input, tokenFilePath: temporaryTokenPath })
    if (result.token !== undefined) return result
    return { ...result, token: readTokenRecord(temporaryTokenPath) }
  }
  return {
    path,
    expectation,
    onboard: deferredOnboard,
    cleanup: () => {
      if (temporaryDirectory !== undefined) {
        rmSync(temporaryDirectory, { recursive: true, force: true })
      }
    },
  }
}

export function planInstallSsoTokenAsset(
  prepared: PreparedInstall,
  context: InstallSsoTokenContext,
): ClientInstallAssetPlan | undefined {
  if (prepared.deferredSsoToken === undefined) return undefined
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path: context.path,
    contents: prepared.deferredSsoToken.contents,
    mode: TOKEN_FILE_MODE,
    backup: CLIENT_INSTALL_BACKUP_POLICY.None,
    expectation: context.expectation,
  }
}

function readTokenRecord(path: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Readonly<Record<string, unknown>>
  }
  throw new Error('Deferred LiteLLM SSO token is malformed.')
}
