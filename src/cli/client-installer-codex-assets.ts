import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
  type ClientInstallExpectation,
} from './client-install-assets'
import { readManagedFileSnapshot } from './managed-file-safety'

export function createCodexWriteAsset(
  path: string,
  contents: string,
  expectation: ClientInstallExpectation = captureCodexExpectation(path),
): ClientInstallAssetPlan {
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path,
    contents,
    expectation,
  }
}

export function createCodexManagedWriteAsset(
  path: string,
  contents: string,
  mode: number,
): ClientInstallAssetPlan {
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path,
    contents,
    mode,
    backup: CLIENT_INSTALL_BACKUP_POLICY.None,
    expectation: captureCodexExpectation(path),
  }
}

export function createCodexRetireAsset(path: string): ClientInstallAssetPlan {
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Retire,
    path,
    expectation: captureCodexExpectation(path),
  }
}

export function readCodexSource(path: string): {
  readonly contents: string
  readonly expectation: ClientInstallExpectation
} {
  const previous = readManagedFileSnapshot(path)
  return {
    contents: previous?.contents.toString('utf8') ?? '',
    expectation: { previous },
  }
}

function captureCodexExpectation(path: string): ClientInstallExpectation {
  return { previous: readManagedFileSnapshot(path) }
}
