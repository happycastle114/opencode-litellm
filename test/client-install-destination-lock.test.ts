import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CLIENT_INSTALL_ASSET_OPERATION } from '../src/cli/client-install-assets'
import {
  acquireClientInstallDestinationLeases,
  releaseClientInstallDestinationLeases,
  resolveClientInstallDestinationLockPath,
  type ClientInstallDestinationLockBoundary,
} from '../src/cli/client-install-destination-lock'
import { stageAndCommitClientInstallTransactionWithLeases } from '../src/cli/client-install-transaction-lease'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'client-destination-lock-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('client destination leases', () => {
  test('acquires canonical destinations in sorted order and releases in reverse', async () => {
    // Given: unsorted assets and a guard with distinct adjacent destinations
    const destinationZ = join(directory, 'z.json')
    const destinationA = join(directory, 'a.json')
    const destinationM = join(directory, 'm.json')
    const destinations = [destinationZ, destinationA, destinationM]
    const acquired: string[] = []
    const released: string[] = []
    const boundary: ClientInstallDestinationLockBoundary = {
      acquire: async (path) => {
        acquired.push(path)
        return async () => { released.push(path) }
      },
    }

    // When: the set is leased and released
    const leases = await acquireClientInstallDestinationLeases({
      assets: [destinationZ, destinationA].map((path) => ({
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path,
        contents: '{}\n',
      })),
      guards: [{ path: destinationM, expectation: { previous: undefined } }],
    }, boundary)
    await releaseClientInstallDestinationLeases(leases)

    // Then: acquisition is deterministic and cleanup is strict reverse order
    const expected = destinations.map((path) => realpathDestination(path)).sort()
    expect(acquired).toEqual(expected)
    expect(released).toEqual([...expected].reverse())
  })

  test('uses an adjacent destination-scoped lease when the parent is missing', async () => {
    // Given: a destination whose nested parent hierarchy does not exist
    const destination = join(directory, 'missing', 'nested', 'settings.json')

    // When: the real proper-lockfile lease is acquired
    const leases = await acquireClientInstallDestinationLeases({
      assets: [{
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path: destination,
        contents: '{}\n',
      }],
      guards: [],
    })
    const canonical = realpathDestination(destination)
    const lockPath = resolveClientInstallDestinationLockPath(canonical)

    // Then: the lease is adjacent, exclusive, and removable without a broad temp lock
    expect(dirname(lockPath)).toBe(dirname(canonical))
    expect(existsSync(lockPath)).toBe(true)
    await releaseClientInstallDestinationLeases(leases)
    expect(existsSync(lockPath)).toBe(false)
  })

  test('holds every destination lease until rollback restores prior files', async () => {
    // Given: two existing destinations and a failure during the second promotion
    const first = join(directory, 'first.json')
    const second = join(directory, 'second.json')
    writeFileSync(first, '{"value":"first-old"}\n')
    writeFileSync(second, '{"value":"second-old"}\n')
    const lockPaths = [first, second].map(
      (path) => resolveClientInstallDestinationLockPath(realpathDestination(path)),
    )
    let observedRollback = false

    // When: the leased transaction rolls its earlier promotion back
    const operation = stageAndCommitClientInstallTransactionWithLeases({
      assets: [
        {
          operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
          path: first,
          contents: '{"value":"first-new"}\n',
        },
        {
          operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
          path: second,
          contents: '{"value":"second-new"}\n',
        },
      ],
      guards: [],
      now: () => new Date(0),
      commitBoundary: {
        moveExclusive: (source, destination) => {
          if (destination === second && source.endsWith('.tmp') &&
            !source.endsWith('.rollback.tmp')) {
            throw new Error('injected second promotion failure')
          }
          if (destination === first && source.endsWith('.rollback.tmp')) {
            observedRollback = lockPaths.every(existsSync)
          }
          linkSync(source, destination)
          unlinkSync(source)
        },
      },
    })
    await expect(operation).rejects.toThrow('injected second promotion failure')

    // Then: rollback ran under both leases and release left exact originals
    expect(observedRollback).toBe(true)
    expect(readFileSync(first, 'utf8')).toBe('{"value":"first-old"}\n')
    expect(readFileSync(second, 'utf8')).toBe('{"value":"second-old"}\n')
    expect(lockPaths.some(existsSync)).toBe(false)
  })
})

function realpathDestination(path: string): string {
  return join(realpathSync(dirname(path)), path.slice(dirname(path).length + 1))
}
