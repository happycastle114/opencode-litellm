import { linkSync, unlinkSync } from 'node:fs'
import { CLIENT_INSTALL_ASSET_OPERATION } from './client-install-assets'
import { postCommitCleanup } from './client-install-post-commit-cleanup'
import { assertClientInstallReservedPaths, cleanupClientInstallTransaction, readPreviousClientInstallFile, samePreviousClientInstallFile, setClientInstallMode, validateClientInstallPathGuards } from './client-install-transaction-stage'
import {
  CLIENT_INSTALL_TRANSACTION_STATE,
  ClientInstallTransactionError,
  clientInstallConcurrentChange,
  clientInstallDestinationTypeError,
  requiredClientInstallPath,
  type ClientInstallCommitBoundary,
  type ClientInstallTransactionCommitResult,
  type StagedClientInstallEntry,
  type StagedClientInstallTransaction,
} from './client-install-transaction-state'
import { CONFIG_FILE_MODE } from './file-adapter'
import { lstatManagedPath, managedPathEntryExists, readManagedFileSnapshot, sameManagedFileIdentity } from './managed-file-safety'

const FILE_NOT_FOUND = 'ENOENT' as const

export function commitClientInstallTransaction(
  transaction: StagedClientInstallTransaction,
  boundary: ClientInstallCommitBoundary = {
    moveExclusive: moveFileExclusive,
  },
): ClientInstallTransactionCommitResult {
  assertStaged(transaction)
  try {
    validateSnapshots(transaction.entries)
    validateClientInstallPathGuards(transaction.guards)
    for (const entry of transaction.entries) promoteEntry(entry, boundary)
    for (const entry of transaction.entries) finalizeEntry(entry, boundary)
  } catch (error) {
    const rollbackError = rollback(transaction, boundary)
    transaction.state = CLIENT_INSTALL_TRANSACTION_STATE.Aborted
    if (rollbackError !== undefined) throw rollbackError
    throw error
  }
  transaction.state = CLIENT_INSTALL_TRANSACTION_STATE.Committed
  return { warnings: postCommitCleanup(transaction, boundary) }
}

export function abortClientInstallTransaction(
  transaction: StagedClientInstallTransaction,
): void {
  if (transaction.state !== CLIENT_INSTALL_TRANSACTION_STATE.Staged) return
  cleanupClientInstallTransaction(transaction)
  transaction.state = CLIENT_INSTALL_TRANSACTION_STATE.Aborted
}

function validateSnapshots(entries: readonly StagedClientInstallEntry[]): void {
  for (const entry of entries) {
    const current = readPreviousClientInstallFile(entry.asset.path)
    if (!samePreviousClientInstallFile(current, entry.previous)) {
      throw clientInstallConcurrentChange(entry.asset.path)
    }
    assertClientInstallReservedPaths(entry, true)
    if (entry.asset.operation === CLIENT_INSTALL_ASSET_OPERATION.Write) {
      const path = requiredClientInstallPath(entry.stagePath, entry.asset.path)
      const staged = readManagedFileSnapshot(path)
      if (staged === undefined || !sameManagedFileIdentity(
        lstatManagedPath(path),
        entry.stageIdentity,
      ) || !staged.contents.equals(Buffer.from(entry.asset.contents))) {
        throw clientInstallConcurrentChange(entry.asset.path)
      }
    }
  }
}

function promoteEntry(
  entry: StagedClientInstallEntry,
  boundary: ClientInstallCommitBoundary,
): void {
  if (entry.asset.operation === CLIENT_INSTALL_ASSET_OPERATION.Retire) {
    if (entry.previous === undefined) return
    movePreviousToRollback(entry, boundary)
    entry.rollbackOwned = true
    entry.rollbackIdentity = entry.previous
    entry.promoted = true
    return
  }
  if (entry.unchanged) {
    entry.promoted = true
    setClientInstallMode(entry.asset.path, entry.asset.mode ?? CONFIG_FILE_MODE)
    return
  }
  if (entry.previous !== undefined) {
    movePreviousToRollback(entry, boundary)
    entry.rollbackOwned = true
    entry.rollbackIdentity = entry.previous
    entry.promoted = true
  }
  const promotedIdentity = entry.stageIdentity
  boundary.moveExclusive(
    requiredClientInstallPath(entry.stagePath, entry.asset.path),
    entry.asset.path,
    entry.stageIdentity,
  )
  entry.stageOwned = false
  entry.stageIdentity = undefined
  entry.promotedIdentity = promotedIdentity
  entry.promoted = true
  setClientInstallMode(entry.asset.path, entry.asset.mode ?? CONFIG_FILE_MODE)
}

function movePreviousToRollback(
  entry: StagedClientInstallEntry,
  boundary: ClientInstallCommitBoundary,
): void {
  const rollbackPath = requiredClientInstallPath(
    entry.rollbackPath,
    entry.asset.path,
  )
  boundary.moveExclusive(entry.asset.path, rollbackPath, entry.previous)
  const moved = readPreviousClientInstallFile(rollbackPath)
  if (samePreviousClientInstallFile(moved, entry.previous)) return
  try {
    if (moved === undefined) throw clientInstallConcurrentChange(entry.asset.path)
    boundary.moveExclusive(rollbackPath, entry.asset.path, moved)
  } catch {
    throw new ClientInstallTransactionError(
      'Client install failed and rollback was incomplete.',
    )
  }
  throw clientInstallConcurrentChange(entry.asset.path)
}

function finalizeEntry(
  entry: StagedClientInstallEntry,
  boundary: ClientInstallCommitBoundary,
): void {
  if (!entry.promoted || entry.rollbackPath === undefined) return
  if (entry.backupPath !== undefined) {
    boundary.moveExclusive(entry.rollbackPath, entry.backupPath, entry.rollbackIdentity)
    entry.rollbackOwned = false
    entry.rollbackIdentity = undefined
    entry.backupFinalized = true
    setClientInstallMode(entry.backupPath, CONFIG_FILE_MODE)
    return
  }
}

function rollback(
  transaction: StagedClientInstallTransaction,
  boundary: ClientInstallCommitBoundary,
): ClientInstallTransactionError | undefined {
  let incomplete = false
  for (const entry of [...transaction.entries].reverse()) {
    try {
      restoreEntry(entry, boundary)
    } catch {
      incomplete = true
    }
  }
  try {
    cleanupClientInstallTransaction(transaction)
  } catch {
    incomplete = true
  }
  return incomplete
    ? new ClientInstallTransactionError(
        'Client install failed and rollback was incomplete.',
      )
    : undefined
}

function restoreEntry(
  entry: StagedClientInstallEntry,
  boundary: ClientInstallCommitBoundary,
): void {
  if (!entry.promoted) return
  if (entry.unchanged) {
    if (entry.previous !== undefined) setClientInstallMode(entry.asset.path, entry.previous.mode)
    entry.promoted = false
    return
  }
  if (entry.previous === undefined) {
    removeManagedFile(entry.asset.path, entry.promotedIdentity)
    entry.promoted = false
    return
  }
  const source = entry.backupFinalized ? entry.backupPath : entry.rollbackPath
  if (source === undefined || !sameManagedFileIdentity(
    lstatManagedPath(source),
    entry.previous,
  )) {
    throw new ClientInstallTransactionError(
      `Client install recovery source is missing: ${entry.asset.path}`,
    )
  }
  const destinationStatus = lstatManagedPath(entry.asset.path)
  if (destinationStatus !== undefined) {
    if (!sameManagedFileIdentity(destinationStatus, entry.promotedIdentity)) {
      throw clientInstallConcurrentChange(entry.asset.path)
    }
    unlinkSync(entry.asset.path)
  }
  boundary.moveExclusive(source, entry.asset.path, entry.previous)
  entry.rollbackOwned = false
  entry.rollbackIdentity = undefined
  entry.backupFinalized = false
  setClientInstallMode(entry.asset.path, entry.previous.mode)
  entry.promoted = false
}

function removeManagedFile(
  path: string,
  identity: StagedClientInstallEntry['promotedIdentity'],
): void {
  const status = lstatManagedPath(path)
  if (status === undefined) return
  if (!sameManagedFileIdentity(status, identity)) {
    if (!status.isFile()) throw clientInstallDestinationTypeError(path)
    throw clientInstallConcurrentChange(path)
  }
  unlinkSync(path)
}

function moveFileExclusive(
  source: string,
  destination: string,
  expected?: StagedClientInstallEntry['previous'],
): void {
  linkSync(source, destination)
  try {
    if (expected !== undefined && !samePreviousClientInstallFile(
      readPreviousClientInstallFile(destination),
      expected,
    )) throw clientInstallConcurrentChange(source)
    unlinkSync(source)
  } catch (error) {
    try { unlinkSync(destination) } catch (cleanupError) {
      if (!(cleanupError instanceof Error && 'code' in cleanupError &&
        cleanupError.code === FILE_NOT_FOUND)) throw cleanupError
    }
    throw error
  }
}

function assertStaged(transaction: StagedClientInstallTransaction): void {
  if (transaction.state !== CLIENT_INSTALL_TRANSACTION_STATE.Staged) {
    throw new ClientInstallTransactionError(
      'Client install transaction is no longer staged.',
    )
  }
}
