import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ClientInstallAssetPlan } from './client-install-assets'
import {
  ClientInstallTransactionError,
  clientInstallDestinationTypeError,
  type StagedClientInstallEntry,
} from './client-install-transaction-state'
import {
  lstatManagedPath,
  managedPathEntryExists,
} from './managed-file-safety'

const DIRECTORY_MODE = 0o700

export function assertUniqueClientInstallDestinations(
  assets: readonly ClientInstallAssetPlan[],
): void {
  const paths = new Set<string>()
  for (const asset of assets) {
    if (paths.has(asset.path)) {
      throw new ClientInstallTransactionError(
        `Duplicate client asset destination: ${asset.path}`,
      )
    }
    paths.add(asset.path)
  }
}

export function assertDisjointClientInstallTransactionPaths(
  entries: readonly StagedClientInstallEntry[],
): void {
  const paths = new Set<string>()
  for (const entry of entries) {
    for (const path of reservedPaths(entry)) {
      if (paths.has(path)) {
        throw new ClientInstallTransactionError(
          `Client transaction paths overlap: ${path}`,
        )
      }
      paths.add(path)
    }
  }
}

export function createClientInstallParentDirectories(
  entries: readonly StagedClientInstallEntry[],
  created: string[],
): void {
  const missing = new Set<string>()
  for (const entry of entries) collectMissingDirectories(dirname(entry.asset.path), missing)
  for (const path of [...missing].sort((left, right) => left.length - right.length)) {
    if (managedPathEntryExists(path)) continue
    mkdirSync(path, { mode: DIRECTORY_MODE })
    created.push(path)
  }
}

function reservedPaths(entry: StagedClientInstallEntry): readonly string[] {
  return [
    entry.asset.path,
    entry.stagePath,
    entry.rollbackPath,
    entry.backupPath,
  ].filter((path): path is string => path !== undefined)
}

function collectMissingDirectories(path: string, missing: Set<string>): void {
  const status = lstatManagedPath(path)
  if (status !== undefined) {
    if (!status.isDirectory()) {
      throw clientInstallDestinationTypeError(path)
    }
    return
  }
  collectMissingDirectories(dirname(path), missing)
  missing.add(path)
}
