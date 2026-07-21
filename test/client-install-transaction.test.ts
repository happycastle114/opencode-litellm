import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  CLIENT_INSTALL_BACKUP_POLICY,
  type ClientInstallAssetPlan,
} from '../src/cli/client-install-assets'
import {
  commitClientInstallTransaction,
  stageClientInstallTransaction,
} from '../src/cli/client-install-transaction'
import { resolveClientInstallDestinationLockPath } from '../src/cli/client-install-destination-lock'
import { stageAndCommitClientInstallTransactionWithLeases } from '../src/cli/client-install-transaction-lease'
import { readManagedFileSnapshot } from '../src/cli/managed-file-safety'

const FILE_MODE = 0o640
let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'client-install-transaction-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('client install filesystem transaction', () => {
  test('rolls earlier promotions back when a later promotion fails', () => {
    // Given: two changed destinations staged with their original bytes and modes
    const first = join(directory, 'first.json')
    const second = join(directory, 'second.json')
    seed(first, '{"value":"first-old"}\n')
    seed(second, '{"value":"second-old"}\n')
    const before = [snapshot(first), snapshot(second)]
    const assets = [
      writeAsset(first, '{"value":"first-new"}\n'),
      writeAsset(second, '{"value":"second-new"}\n'),
    ]
    const transaction = stageClientInstallTransaction(assets, () => new Date(0))
    const secondStage = transaction.entries[1]?.stagePath
    let injected = false

    // When: the second staged-file promotion fails after the first has completed
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (!injected && source === secondStage) {
          injected = true
          throw new Error('injected second promotion failure')
        }
        moveExclusive(source, destination)
      },
    })).toThrow('injected second promotion failure')

    // Then: both originals are restored and transaction artifacts are absent
    expect(injected).toBe(true)
    expect(snapshot(first)).toEqual(before[0])
    expect(snapshot(second)).toEqual(before[1])
    expect(readdirSync(directory).sort()).toEqual(['first.json', 'second.json'])
  })

  test('repairs an unchanged staged destination to its requested mode', () => {
    // Given: byte-identical contents with a broader existing mode
    const path = join(directory, 'launch.json')
    const contents = '{"schemaVersion":1}\n'
    writeFileSync(path, contents)
    if (process.platform !== 'win32') chmodSync(path, 0o644)
    const transaction = stageClientInstallTransaction([
      { ...writeAsset(path, contents), mode: 0o600 },
    ], () => new Date(0))

    // When: the staged transaction commits without replacing the bytes
    commitClientInstallTransaction(transaction)

    // Then: mode is owner-only with no backup or staging leak
    expect(readFileSync(path, 'utf8')).toBe(contents)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(directory)).toEqual(['launch.json'])
    expect(existsSync(`${path}.19700101T000000.bak`)).toBe(false)
  })

  test('commits independently of foreign legacy lock-directory contents', () => {
    // Given: a backup-free update and a foreign directory at the retired lock path
    const path = join(directory, 'legacy-lock.json')
    seed(path, '{"value":"old"}\n')
    const foreignLock = `${path}.opencode-litellm-install.lock`
    mkdirSync(foreignLock)
    writeFileSync(join(foreignLock, 'foreign'), 'preserve\n')
    const transaction = stageClientInstallTransaction([{
      ...writeAsset(path, '{"value":"managed"}\n'),
      backup: CLIENT_INSTALL_BACKUP_POLICY.None,
    }], () => new Date(0))

    // When: the data transaction commits without owning per-path lock cleanup
    commitClientInstallTransaction(transaction)

    // Then: managed bytes commit and the unrelated directory remains untouched
    expect(readFileSync(path, 'utf8')).toBe('{"value":"managed"}\n')
    expect(readFileSync(join(foreignLock, 'foreign'), 'utf8')).toBe('preserve\n')
  })

  test('recovers a stale lease after SIGKILL without clobbering its recovery orphan', async () => {
    // Given: a leased child is killed after exclusively moving the original out of place
    const path = join(directory, 'crash.json')
    const original = '{"value":"exact-old"}\n'
    seed(path, original)
    const transactionModule = new URL(
      '../src/cli/client-install-transaction-lease.ts',
      import.meta.url,
    ).href
    const child = spawnSync('bun', ['--eval', [
      `import { linkSync, unlinkSync } from 'node:fs'`,
      `import { stageAndCommitClientInstallTransactionWithLeases } from ${JSON.stringify(transactionModule)}`,
      `await stageAndCommitClientInstallTransactionWithLeases({ assets: [{ operation: 'write', path: ${JSON.stringify(path)}, contents: '{"value":"first-attempt"}\\n' }], guards: [], now: () => new Date(0), commitBoundary: { moveExclusive(source, destination) { linkSync(source, destination); unlinkSync(source); if (destination.endsWith('.rollback.tmp')) process.kill(process.pid, 'SIGKILL') } } })`,
    ].join(';')])
    expect(child.signal).toBe('SIGKILL')
    expect(existsSync(path)).toBe(false)
    const lockPath = resolveClientInstallDestinationLockPath(join(
      realpathSync(dirname(path)),
      basename(path),
    ))
    expect(existsSync(lockPath)).toBe(true)
    const recoveryNames = readdirSync(directory).filter(
      (name) => /^crash\.json\.[0-9a-f-]{36}\.rollback\.tmp$/.test(name),
    )
    expect(recoveryNames).toHaveLength(1)
    const recoveryName = recoveryNames[0]
    if (recoveryName === undefined) throw new Error('Expected a recovery file.')
    const recoveryPath = join(directory, recoveryName)

    // When: a fresh transaction reclaims the stale lease and converges twice
    const staleTime = new Date(Date.now() - 60_000)
    utimesSync(lockPath, staleTime, staleTime)
    for (const contents of [
      '{"value":"converged"}\n',
      '{"value":"converged"}\n',
    ]) {
      await stageAndCommitClientInstallTransactionWithLeases({
        assets: [writeAsset(path, contents)],
        guards: [],
        now: () => new Date(0),
      })
    }

    // Then: final JSON is valid, the original remains recoverable, and no lease remains
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ value: 'converged' })
    expect(readFileSync(recoveryPath, 'utf8')).toBe(original)
    expect(existsSync(lockPath)).toBe(false)
  })

  test('preserves a foreign rollback collision discovered after staging', () => {
    // Given: a changed file is staged before another owner creates the rollback path
    const path = join(directory, 'foreign.json')
    seed(path, '{"value":"old"}\n')
    const transaction = stageClientInstallTransaction([
      writeAsset(path, '{"value":"new"}\n'),
    ], () => new Date(0))
    const collision = transaction.entries[0]?.rollbackPath
    if (collision === undefined) throw new Error('Expected rollback path.')
    writeFileSync(collision, 'foreign-owner\n')

    // When: commit validation observes the late reserved-path collision
    expect(() => commitClientInstallTransaction(transaction)).toThrow()

    // Then: neither the destination nor the foreign file is deleted
    expect(readFileSync(path, 'utf8')).toBe('{"value":"old"}\n')
    expect(readFileSync(collision, 'utf8')).toBe('foreign-owner\n')
  })

  test('preserves the sole original at its rollback path when recovery rename fails', () => {
    // Given: promotion and the subsequent recovery rename are both injected to fail
    const path = join(directory, 'recovery.json')
    seed(path, '{"value":"old"}\n')
    const transaction = stageClientInstallTransaction([
      writeAsset(path, '{"value":"new"}\n'),
    ], () => new Date(0))
    const rollbackPath = transaction.entries[0]?.rollbackPath
    const stagePath = transaction.entries[0]?.stagePath
    if (rollbackPath === undefined || stagePath === undefined) {
      throw new Error('Expected staged recovery paths.')
    }

    // When: the staged promotion and rollback rename cannot complete
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (source.endsWith('.tmp') && source !== path) {
          if (source === rollbackPath) throw new Error('injected recovery failure')
          if (source === stagePath) {
            throw new Error('injected promotion failure')
          }
        }
        moveExclusive(source, destination)
      },
    })).toThrow('rollback was incomplete')

    // Then: the original bytes remain recoverable and are never unlinked
    expect(existsSync(path)).toBe(false)
    expect(readFileSync(rollbackPath, 'utf8')).toBe('{"value":"old"}\n')
    expect(statSync(rollbackPath).mode & 0o777).toBe(FILE_MODE)
  })

  test('restores only mode for an unchanged entry when a later promotion fails', () => {
    // Given: an unchanged first file, a stale restore path, and a changed second file
    const first = join(directory, 'unchanged.json')
    const second = join(directory, 'later.json')
    writeFileSync(first, '{"same":true}\n')
    chmodSync(first, 0o644)
    seed(second, '{"value":"old"}\n')
    const inode = statSync(first).ino
    const staleRestore = `${first}.${process.pid}.restore.tmp`
    writeFileSync(staleRestore, 'foreign-restore\n')
    const transaction = stageClientInstallTransaction([
      { ...writeAsset(first, '{"same":true}\n'), mode: 0o600 },
      writeAsset(second, '{"value":"new"}\n'),
    ], () => new Date(0))
    const secondStage = transaction.entries[1]?.stagePath

    // When: the later staged-file promotion fails
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (source === secondStage) throw new Error('later failure')
        moveExclusive(source, destination)
      },
    })).toThrow('later failure')

    // Then: bytes, inode, and original mode survive without using the stale restore path
    expect(readFileSync(first, 'utf8')).toBe('{"same":true}\n')
    expect(statSync(first).ino).toBe(inode)
    expect(statSync(first).mode & 0o777).toBe(0o644)
    expect(readFileSync(staleRestore, 'utf8')).toBe('foreign-restore\n')
  })

})

function writeAsset(path: string, contents: string): ClientInstallAssetPlan {
  return { operation: CLIENT_INSTALL_ASSET_OPERATION.Write, path, contents }
}

function seed(path: string, contents: string): void {
  writeFileSync(path, contents)
  chmodSync(path, FILE_MODE)
}

function snapshot(path: string): { readonly contents: Buffer; readonly mode: number } {
  return { contents: readFileSync(path), mode: statSync(path).mode & 0o777 }
}

function moveExclusive(source: string, destination: string): void {
  linkSync(source, destination)
  unlinkSync(source)
}
