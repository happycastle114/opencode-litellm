import type {
  ClientInstallAssetPlan,
  ClientInstallPathGuard,
} from './client-install-assets'

export const CLIENT_INSTALL_TRANSACTION_STATE = {
  Aborted: 'aborted',
  Committed: 'committed',
  Staged: 'staged',
} as const

export const CLIENT_INSTALL_TRANSACTION_WARNING = {
  RollbackCleanup: 'Client install committed, but temporary rollback cleanup failed; an orphaned recovery file may remain.',
  StagingCleanup: 'Client install committed, but temporary staging cleanup failed; temporary directories may remain.',
} as const

export type PreviousClientInstallFile = {
  readonly contents: Buffer
  readonly mode: number
  readonly device: number
  readonly inode: number
}

export type StagedClientInstallEntry = {
  readonly asset: ClientInstallAssetPlan
  readonly previous: PreviousClientInstallFile | undefined
  readonly stagePath: string | undefined
  readonly rollbackPath: string | undefined
  readonly backupPath: string | undefined
  readonly unchanged: boolean
  stageOwned: boolean
  stageIdentity: PreviousClientInstallFile | undefined
  rollbackOwned: boolean
  rollbackIdentity: PreviousClientInstallFile | undefined
  promotedIdentity: PreviousClientInstallFile | undefined
  promoted: boolean
  backupFinalized: boolean
}

export type StagedClientInstallTransaction = {
  readonly entries: StagedClientInstallEntry[]
  readonly guards: readonly ClientInstallPathGuard[]
  readonly createdDirectories: string[]
  state: typeof CLIENT_INSTALL_TRANSACTION_STATE[
    keyof typeof CLIENT_INSTALL_TRANSACTION_STATE
  ]
}

export type ClientInstallCommitBoundary = {
  readonly moveExclusive: (
    source: string,
    destination: string,
    expected?: PreviousClientInstallFile,
  ) => void
  readonly discardRollbackFiles?: (
    transaction: StagedClientInstallTransaction,
  ) => void
  readonly cleanupTransaction?: (
    transaction: StagedClientInstallTransaction,
  ) => void
}

export type ClientInstallTransactionCommitResult = {
  readonly warnings: readonly string[]
}

export class ClientInstallTransactionError extends Error {
  readonly name = 'ClientInstallTransactionError'
}

export function requiredClientInstallPath(
  path: string | undefined,
  destination: string,
): string {
  if (path !== undefined) return path
  throw new ClientInstallTransactionError(
    `Client asset staging path is missing: ${destination}`,
  )
}

export function clientInstallDestinationTypeError(
  path: string,
): ClientInstallTransactionError {
  return new ClientInstallTransactionError(
    `Client asset destination must be a file: ${path}`,
  )
}

export function clientInstallConcurrentChange(
  path: string,
): ClientInstallTransactionError {
  return new ClientInstallTransactionError(
    `Client asset changed during installation: ${path}`,
  )
}
