import {
  CLIENT_INSTALL_TRANSACTION_WARNING,
  type ClientInstallCommitBoundary,
  type StagedClientInstallTransaction,
} from './client-install-transaction-state'
import {
  cleanupClientInstallTransaction,
  discardClientInstallRollbackFiles,
} from './client-install-transaction-stage'

export function postCommitCleanup(
  transaction: StagedClientInstallTransaction,
  boundary: ClientInstallCommitBoundary,
): readonly string[] {
  const warnings: string[] = []
  try {
    (boundary.discardRollbackFiles ?? discardClientInstallRollbackFiles)(transaction)
  } catch {
    warnings.push(CLIENT_INSTALL_TRANSACTION_WARNING.RollbackCleanup)
  }
  try {
    (boundary.cleanupTransaction ?? cleanupClientInstallTransaction)(transaction)
  } catch {
    warnings.push(CLIENT_INSTALL_TRANSACTION_WARNING.StagingCleanup)
  }
  return warnings
}
