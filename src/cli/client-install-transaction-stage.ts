import { randomUUID } from 'node:crypto'
import {
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
  type ClientInstallPathGuard,
} from './client-install-assets'
import {
  CLIENT_INSTALL_TRANSACTION_STATE,
  ClientInstallTransactionError,
  clientInstallConcurrentChange,
  requiredClientInstallPath,
  type PreviousClientInstallFile,
  type StagedClientInstallEntry,
  type StagedClientInstallTransaction,
} from './client-install-transaction-state'
import {
  CONFIG_FILE_MODE,
  resolveConfigBackupPath,
} from './file-adapter'
import {
  assertDisjointClientInstallTransactionPaths,
  assertUniqueClientInstallDestinations,
  createClientInstallParentDirectories,
} from './client-install-transaction-paths'
import {
  lstatManagedPath,
  managedPathEntryExists,
  readManagedFileSnapshot,
  sameManagedFileIdentity,
  setManagedFileMode,
} from './managed-file-safety'

const PLATFORM = { Windows: 'win32' } as const
const DIRECTORY_CLEANUP_ERROR_CODE = {
  AlreadyExists: 'EEXIST',
  NotDirectory: 'ENOTDIR',
  NotEmpty: 'ENOTEMPTY',
  NotFound: 'ENOENT',
} as const

export function stageClientInstallTransaction(
  assets: readonly ClientInstallAssetPlan[],
  now: () => Date,
  guards: readonly ClientInstallPathGuard[] = [],
): StagedClientInstallTransaction {
  assertUniqueClientInstallDestinations(assets)
  const transactionId = randomUUID()
  const timestamp = now()
  const entries = assets.map((asset) => planEntry(asset, timestamp, transactionId))
  assertDisjointClientInstallTransactionPaths(entries)
  const transaction: StagedClientInstallTransaction = {
    entries,
    guards,
    createdDirectories: [],
    state: CLIENT_INSTALL_TRANSACTION_STATE.Staged,
  }
  try {
    createClientInstallParentDirectories(entries, transaction.createdDirectories)
    validateSnapshots(entries)
    validateClientInstallPathGuards(guards)
    for (const entry of entries) {
      stageEntry(entry)
    }
    return transaction
  } catch (error) {
    cleanupClientInstallTransaction(transaction)
    transaction.state = CLIENT_INSTALL_TRANSACTION_STATE.Aborted
    throw error
  }
}

export function readPreviousClientInstallFile(
  path: string,
): PreviousClientInstallFile | undefined {
  const snapshot = readManagedFileSnapshot(path)
  if (snapshot === undefined) return undefined
  return snapshot
}

export function samePreviousClientInstallFile(
  left: PreviousClientInstallFile | undefined,
  right: PreviousClientInstallFile | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.mode === right.mode &&
      left.device === right.device && left.inode === right.inode &&
      left.contents.equals(right.contents)
}

export function assertClientInstallReservedPaths(
  entry: StagedClientInstallEntry,
  staged = false,
): void {
  if (!staged && entry.stagePath !== undefined && managedPathEntryExists(entry.stagePath)) {
    throw new ClientInstallTransactionError(
      `Client asset staging path is unavailable: ${entry.stagePath}`,
    )
  }
  for (const path of [entry.rollbackPath, entry.backupPath]) {
    if (path !== undefined && managedPathEntryExists(path)) {
      throw clientInstallConcurrentChange(entry.asset.path)
    }
  }
}

export function cleanupClientInstallTransaction(
  transaction: StagedClientInstallTransaction,
): void {
  for (const entry of transaction.entries) {
    if (entry.stageOwned && entry.stagePath !== undefined && sameManagedFileIdentity(
      lstatManagedPath(entry.stagePath),
      entry.stageIdentity,
    )) {
      unlinkSync(entry.stagePath)
      entry.stageOwned = false
      entry.stageIdentity = undefined
    }
  }
  for (const path of [...transaction.createdDirectories].reverse()) {
    removeCreatedDirectory(path)
  }
}

export function discardClientInstallRollbackFiles(
  transaction: StagedClientInstallTransaction,
): void {
  for (const entry of transaction.entries) {
    if (!entry.rollbackOwned || entry.rollbackPath === undefined ||
      !sameManagedFileIdentity(
        lstatManagedPath(entry.rollbackPath),
        entry.rollbackIdentity,
      )) continue
    try {
      unlinkSync(entry.rollbackPath)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error &&
        error.code === DIRECTORY_CLEANUP_ERROR_CODE.NotFound)) throw error
    }
    entry.rollbackOwned = false
    entry.rollbackIdentity = undefined
  }
}

function removeCreatedDirectory(path: string): void {
  try {
    rmdirSync(path)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error
    switch (error.code) {
      case DIRECTORY_CLEANUP_ERROR_CODE.AlreadyExists:
      case DIRECTORY_CLEANUP_ERROR_CODE.NotDirectory:
      case DIRECTORY_CLEANUP_ERROR_CODE.NotEmpty:
      case DIRECTORY_CLEANUP_ERROR_CODE.NotFound:
        return
      default:
        throw error
    }
  }
}

export function setClientInstallMode(path: string, mode: number): void {
  if (process.platform !== PLATFORM.Windows) setManagedFileMode(path, mode)
}

function planEntry(
  asset: ClientInstallAssetPlan,
  now: Date,
  transactionId: string,
): StagedClientInstallEntry {
  const previous = readPreviousClientInstallFile(asset.path)
  if (asset.expectation !== undefined && !samePreviousClientInstallFile(
    previous,
    asset.expectation.previous,
  )) throw clientInstallConcurrentChange(asset.path)
  const isWrite = asset.operation === CLIENT_INSTALL_ASSET_OPERATION.Write
  const unchanged = isWrite && previous !== undefined &&
    previous.contents.equals(Buffer.from(asset.contents))
  const needsRollback = previous !== undefined && !unchanged
  const needsBackup = needsRollback && (
    asset.operation === CLIENT_INSTALL_ASSET_OPERATION.Retire ||
    (asset.backup ?? CLIENT_INSTALL_BACKUP_POLICY.Create) ===
      CLIENT_INSTALL_BACKUP_POLICY.Create
  )
  const entry: StagedClientInstallEntry = {
    asset,
    previous,
    stagePath: isWrite ? `${asset.path}.${transactionId}.tmp` : undefined,
    rollbackPath: needsRollback
      ? `${asset.path}.${transactionId}.rollback.tmp`
      : undefined,
    backupPath: needsBackup ? resolveConfigBackupPath(asset.path, now) : undefined,
    unchanged,
    stageOwned: false,
    stageIdentity: undefined,
    rollbackOwned: false,
    rollbackIdentity: undefined,
    promotedIdentity: undefined,
    promoted: false,
    backupFinalized: false,
  }
  assertClientInstallReservedPaths(entry)
  return entry
}

export function validateClientInstallPathGuards(
  guards: readonly ClientInstallPathGuard[],
): void {
  for (const guard of guards) {
    if (!samePreviousClientInstallFile(
      readPreviousClientInstallFile(guard.path),
      guard.expectation.previous,
    )) throw clientInstallConcurrentChange(guard.path)
  }
}

function validateSnapshots(entries: readonly StagedClientInstallEntry[]): void {
  for (const entry of entries) {
    if (!samePreviousClientInstallFile(
      readPreviousClientInstallFile(entry.asset.path),
      entry.previous,
    )) throw clientInstallConcurrentChange(entry.asset.path)
  }
}

function stageEntry(entry: StagedClientInstallEntry): void {
  if (entry.asset.operation === CLIENT_INSTALL_ASSET_OPERATION.Retire) return
  const path = requiredClientInstallPath(entry.stagePath, entry.asset.path)
  const expected = Buffer.from(entry.asset.contents)
  writeFileSync(path, expected, {
    flag: 'wx',
    ...(process.platform === PLATFORM.Windows
      ? {}
      : { mode: entry.asset.mode ?? CONFIG_FILE_MODE }),
  })
  entry.stageOwned = true
  const snapshot = readManagedFileSnapshot(path)
  entry.stageIdentity = snapshot
  if (snapshot === undefined || !snapshot.contents.equals(expected)) {
    throw new ClientInstallTransactionError(
      `Could not stage client asset: ${entry.asset.path}`,
    )
  }
}
