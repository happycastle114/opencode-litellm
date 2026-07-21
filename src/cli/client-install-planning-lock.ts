import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { lock as acquireFileLock } from 'proper-lockfile'
import { ClientInstallTransactionError } from './client-install-transaction'

const LOCK_DIRECTORY = '.opencode-litellm-install.lock' as const
export const CLIENT_INSTALL_LOCK_TIMING = {
  stale: 10_000,
  update: 3_000,
} as const
export const CLIENT_INSTALL_LOCK_RETRY = {
  retries: 1_200,
  factor: 1,
  minTimeout: 250,
  maxTimeout: 250,
  randomize: true,
} as const
const LEASE_OPERATION_STATUS = {
  Failure: 'failure',
  Success: 'success',
} as const

type LeaseOperationOutcome<Result> =
  | { readonly status: typeof LEASE_OPERATION_STATUS.Success; readonly value: Result }
  | { readonly status: typeof LEASE_OPERATION_STATUS.Failure; readonly error: Error }

export type ClientInstallPlanningLock = {
  readonly path: string
  readonly release: () => Promise<void>
  readonly compromised: () => Error | undefined
}

export async function acquireClientInstallPlanningLock(
  homeDirectory: string,
): Promise<ClientInstallPlanningLock> {
  const canonicalHome = realpathSync(homeDirectory)
  const path = resolveClientInstallPlanningLockPath(canonicalHome)
  let compromisedError: Error | undefined
  try {
    const release = await acquireFileLock(canonicalHome, {
      lockfilePath: path,
      realpath: false,
      stale: CLIENT_INSTALL_LOCK_TIMING.stale,
      update: CLIENT_INSTALL_LOCK_TIMING.update,
      retries: CLIENT_INSTALL_LOCK_RETRY,
      onCompromised: (error) => {
        compromisedError ??= error
      },
    })
    return { path, release, compromised: () => compromisedError }
  } catch (error) {
    const acquisitionError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
    throw new ClientInstallTransactionError(
      `Could not acquire the client installation lease at ${path}: ${message(acquisitionError)}`,
    )
  }
}

export async function releaseClientInstallPlanningLock(
  lease: ClientInstallPlanningLock,
): Promise<void> {
  const compromisedBeforeRelease = lease.compromised()
  if (compromisedBeforeRelease !== undefined) {
    throw compromisedLeaseError(lease.path, compromisedBeforeRelease)
  }
  try {
    await lease.release()
  } catch (error) {
    const releaseError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
    const compromisedDuringRelease = lease.compromised()
    if (compromisedDuringRelease !== undefined) {
      throw compromisedLeaseError(lease.path, compromisedDuringRelease)
    }
    throw new ClientInstallTransactionError(
      `Client installation lease release failed at ${lease.path}: ${message(releaseError)}`,
    )
  }
}

export function resolveClientInstallPlanningLockPath(
  canonicalHomeDirectory: string,
): string {
  return join(canonicalHomeDirectory, LOCK_DIRECTORY)
}

export async function withClientInstallPlanningLock<Result>(
  homeDirectory: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const lease = await acquireClientInstallPlanningLock(homeDirectory)
  let outcome: LeaseOperationOutcome<Result>
  try {
    outcome = {
      status: LEASE_OPERATION_STATUS.Success,
      value: await operation(),
    }
  } catch (error) {
    outcome = {
      status: LEASE_OPERATION_STATUS.Failure,
      error: error instanceof Error
        ? error
        : new ClientInstallTransactionError(String(error)),
    }
  }
  let releaseError: Error | undefined
  try {
    await releaseClientInstallPlanningLock(lease)
  } catch (error) {
    releaseError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
  }
  switch (outcome.status) {
    case LEASE_OPERATION_STATUS.Failure:
      if (releaseError !== undefined) {
        throw new Error(
          `${message(outcome.error)}; additionally, ${message(releaseError)}`,
          { cause: outcome.error },
        )
      }
      throw outcome.error
    case LEASE_OPERATION_STATUS.Success:
      if (releaseError !== undefined) throw releaseError
      return outcome.value
    default:
      return assertNever(outcome)
  }
}

function message(error: Error): string {
  return error.message
}

function assertNever(value: never): never {
  throw new ClientInstallTransactionError(
    `Unsupported planning lease outcome: ${String(value)}`,
  )
}

function compromisedLeaseError(
  path: string,
  error: Error,
): ClientInstallTransactionError {
  return new ClientInstallTransactionError(
    `Client installation lease was compromised at ${path}: ${message(error)}`,
  )
}
