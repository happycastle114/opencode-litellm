import { mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { lock as acquireFileLock } from 'proper-lockfile'
import type {
  ClientInstallAssetPlan,
  ClientInstallPathGuard,
} from './client-install-assets'
import {
  CLIENT_INSTALL_LOCK_RETRY,
  CLIENT_INSTALL_LOCK_TIMING,
} from './client-install-planning-lock'
import {
  ClientInstallTransactionError,
} from './client-install-transaction-state'
import {
  assertManagedParentDirectories,
  assertManagedRegularFileOrAbsent,
} from './managed-file-safety'

const DESTINATION_LOCK_SUFFIX = '.opencode-litellm-destination.lock' as const
const DIRECTORY_MODE = 0o700

type DestinationLease = {
  readonly destination: string
  readonly lockPath: string
  readonly release: () => Promise<void>
  readonly compromised: () => Error | undefined
}

export type ClientInstallDestinationLockBoundary = {
  readonly acquire: typeof acquireFileLock
}

const NODE_DESTINATION_LOCK_BOUNDARY: ClientInstallDestinationLockBoundary = {
  acquire: acquireFileLock,
}

export type ClientInstallDestinationLeases = {
  readonly leases: readonly DestinationLease[]
}

export type ClientInstallDestinationSelection = {
  readonly assets: readonly ClientInstallAssetPlan[]
  readonly guards: readonly ClientInstallPathGuard[]
}

export async function acquireClientInstallDestinationLeases(
  selection: ClientInstallDestinationSelection,
  boundary: ClientInstallDestinationLockBoundary = NODE_DESTINATION_LOCK_BOUNDARY,
): Promise<ClientInstallDestinationLeases> {
  const destinations = canonicalDestinations(selection)
  assertDestinationLocksDisjoint(destinations)
  const leases: DestinationLease[] = []
  try {
    for (const destination of destinations) {
      leases.push(await acquireDestinationLease(destination, boundary))
    }
    return { leases }
  } catch (error) {
    const acquisitionError = error instanceof Error
      ? error
      : new ClientInstallTransactionError(String(error))
    const releaseError = await releaseLeases(leases)
    throw destinationLeaseError('acquisition', acquisitionError, releaseError)
  }
}

export async function releaseClientInstallDestinationLeases(
  owned: ClientInstallDestinationLeases,
): Promise<void> {
  const error = await releaseLeases([...owned.leases])
  if (error !== undefined) throw destinationLeaseError('release', error)
}

export function resolveClientInstallDestinationLockPath(
  canonicalDestination: string,
): string {
  return `${canonicalDestination}${DESTINATION_LOCK_SUFFIX}`
}

async function acquireDestinationLease(
  destination: string,
  boundary: ClientInstallDestinationLockBoundary,
): Promise<DestinationLease> {
  const lockPath = resolveClientInstallDestinationLockPath(destination)
  let compromisedError: Error | undefined
  const release = await boundary.acquire(destination, {
    lockfilePath: lockPath,
    realpath: false,
    stale: CLIENT_INSTALL_LOCK_TIMING.stale,
    update: CLIENT_INSTALL_LOCK_TIMING.update,
    retries: CLIENT_INSTALL_LOCK_RETRY,
    onCompromised: (error) => { compromisedError ??= error },
  })
  return {
    destination,
    lockPath,
    release,
    compromised: () => compromisedError,
  }
}

async function releaseLeases(leases: DestinationLease[]): Promise<Error | undefined> {
  const failures: Error[] = []
  for (const lease of leases.reverse()) {
    const compromised = lease.compromised()
    if (compromised !== undefined) {
      failures.push(compromised)
      continue
    }
    try {
      await lease.release()
    } catch (error) {
      const releaseError = error instanceof Error
        ? error
        : new ClientInstallTransactionError(String(error))
      failures.push(lease.compromised() ?? releaseError)
    }
  }
  if (failures.length === 0) return undefined
  return failures.length === 1
    ? failures[0]
    : new AggregateError(failures, 'Multiple destination leases failed to release.')
}

function canonicalDestinations(
  selection: ClientInstallDestinationSelection,
): readonly string[] {
  const paths = [
    ...selection.assets.map((asset) => asset.path),
    ...selection.guards.map((guard) => guard.path),
  ]
  return [...new Set(paths.map(canonicalDestination))].sort()
}

function canonicalDestination(path: string): string {
  assertManagedRegularFileOrAbsent(path)
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true, mode: DIRECTORY_MODE })
  assertManagedParentDirectories(path)
  return join(realpathSync(parent), basename(path))
}

function assertDestinationLocksDisjoint(destinations: readonly string[]): void {
  const destinationSet = new Set(destinations)
  for (const destination of destinations) {
    const lockPath = resolveClientInstallDestinationLockPath(destination)
    if (destinationSet.has(lockPath)) {
      throw new ClientInstallTransactionError(
        `Client destination lease overlaps a managed path: ${lockPath}`,
      )
    }
  }
}

function destinationLeaseError(
  operation: 'acquisition' | 'release',
  error: Error,
  additional?: Error,
): ClientInstallTransactionError {
  const detail = additional === undefined
    ? message(error)
    : `${message(error)}; additionally, ${message(additional)}`
  return new ClientInstallTransactionError(
    `Client destination lease ${operation} failed: ${detail}`,
  )
}

function message(error: Error): string {
  return error.message
}
