import {
  acquireClientInstallDestinationLeases,
  releaseClientInstallDestinationLeases,
} from './client-install-destination-lock'
import type {
  ClientInstallAssetPlan,
  ClientInstallPathGuard,
} from './client-install-assets'
import { commitClientInstallTransaction } from './client-install-transaction-commit'
import { stageClientInstallTransaction } from './client-install-transaction-stage'
import {
  ClientInstallTransactionError,
  type ClientInstallCommitBoundary,
  type StagedClientInstallTransaction,
} from './client-install-transaction-state'

const LEASED_TRANSACTION_STATUS = {
  Failure: 'failure',
  Success: 'success',
} as const

type LeasedTransactionOutcome =
  | {
    readonly status: typeof LEASED_TRANSACTION_STATUS.Success
    readonly transaction: StagedClientInstallTransaction
  }
  | {
    readonly status: typeof LEASED_TRANSACTION_STATUS.Failure
    readonly error: Error
  }

export type LeasedClientInstallTransactionOptions = {
  readonly assets: readonly ClientInstallAssetPlan[]
  readonly guards: readonly ClientInstallPathGuard[]
  readonly now: () => Date
  readonly commitBoundary?: ClientInstallCommitBoundary
}

export type LeasedClientInstallTransactionResult = {
  readonly transaction: StagedClientInstallTransaction
  readonly warnings: readonly string[]
}

export async function stageAndCommitClientInstallTransactionWithLeases(
  options: LeasedClientInstallTransactionOptions,
): Promise<LeasedClientInstallTransactionResult> {
  const leases = await acquireClientInstallDestinationLeases(options)
  let transaction: StagedClientInstallTransaction | undefined
  let commitWarnings: readonly string[] = []
  let outcome: LeasedTransactionOutcome
  try {
    transaction = stageClientInstallTransaction(
      options.assets,
      options.now,
      options.guards,
    )
    commitWarnings = commitClientInstallTransaction(transaction, options.commitBoundary).warnings
    outcome = { status: LEASED_TRANSACTION_STATUS.Success, transaction }
  } catch (error) {
    const operationError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
    outcome = { status: LEASED_TRANSACTION_STATUS.Failure, error: operationError }
  }
  let releaseError: Error | undefined
  try {
    await releaseClientInstallDestinationLeases(leases)
  } catch (error) {
    releaseError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
  }
  switch (outcome.status) {
    case LEASED_TRANSACTION_STATUS.Failure:
      if (releaseError !== undefined) {
        throw new ClientInstallTransactionError(
          `${message(outcome.error)}; additionally, ${message(releaseError)}`,
        )
      }
      throw outcome.error
    case LEASED_TRANSACTION_STATUS.Success:
      return {
        transaction: outcome.transaction,
        warnings: [
          ...commitWarnings,
          ...(releaseError === undefined ? [] : [message(releaseError)]),
        ],
      }
    default:
      return assertNever(outcome)
  }
}

function message(error: Error): string {
  return error.message
}

function assertNever(value: never): never {
  throw new ClientInstallTransactionError(
    `Unsupported leased transaction outcome: ${String(value)}`,
  )
}
