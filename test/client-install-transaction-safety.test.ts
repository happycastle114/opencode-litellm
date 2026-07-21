import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  type ClientInstallAssetPlan,
} from '../src/cli/client-install-assets'
import {
  commitClientInstallTransaction,
  stageClientInstallTransaction,
} from '../src/cli/client-install-transaction'
import { readManagedFileSnapshot } from '../src/cli/managed-file-safety'

const FILE_MODE = 0o640
let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'client-install-safety-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('client install transaction safety', () => {
  test('rejects a destination that overlaps another entry backup path', () => {
    // Given: one changed destination and another destination equal to its backup path
    const path = join(directory, 'overlap.json')
    seed(path, '{"value":"old"}\n')
    const backupPath = `${path}.19700101T000000.bak`

    // When: the full transaction path namespace is preflighted
    expect(() => stageClientInstallTransaction([
      writeAsset(path, '{"value":"new"}\n'),
      writeAsset(backupPath, '{"other":true}\n'),
    ], () => new Date(0))).toThrow('paths overlap')

    // Then: no destination, backup, or staging file is changed
    expect(readFileSync(path, 'utf8')).toBe('{"value":"old"}\n')
    expect(existsSync(backupPath)).toBe(false)
    expect(readdirSync(directory)).toEqual(['overlap.json'])
  })

  test('does not clobber a file created immediately before absent promotion', () => {
    // Given: a staged write whose destination was absent at validation
    const path = join(directory, 'late-destination.json')
    const transaction = stageClientInstallTransaction([
      writeAsset(path, '{"managed":true}\n'),
    ], () => new Date(0))

    // When: another owner creates the destination at the exclusive move boundary
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (destination === path) writeFileSync(path, 'foreign-owner\n')
        moveExclusive(source, destination)
      },
    })).toThrow()

    // Then: the foreign file wins and no managed temporary or lock remains
    expect(readFileSync(path, 'utf8')).toBe('foreign-owner\n')
    expect(readdirSync(directory)).toEqual(['late-destination.json'])
  })

  test('does not clobber a backup created immediately before finalization', () => {
    // Given: a changed file with a deterministic recoverable backup destination
    const path = join(directory, 'late-backup.json')
    seed(path, '{"value":"old"}\n')
    const backupPath = `${path}.19700101T000000.bak`
    const transaction = stageClientInstallTransaction([
      writeAsset(path, '{"value":"managed"}\n'),
    ], () => new Date(0))

    // When: another owner creates the backup at the exclusive finalization boundary
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (destination === backupPath) writeFileSync(backupPath, 'foreign-backup\n')
        moveExclusive(source, destination)
      },
    })).toThrow()

    // Then: client state rolls back and the foreign backup remains untouched
    expect(readFileSync(path, 'utf8')).toBe('{"value":"old"}\n')
    expect(readFileSync(backupPath, 'utf8')).toBe('foreign-backup\n')
    expect(readdirSync(directory).sort()).toEqual([
      'late-backup.json',
      'late-backup.json.19700101T000000.bak',
    ])
  })

  test('continues restoring other entries after one recovery move fails', () => {
    // Given: three changed files whose final promotion and recovery will fail
    const first = join(directory, 'first-aggregate.json')
    const second = join(directory, 'second-aggregate.json')
    const third = join(directory, 'third-aggregate.json')
    const paths = [first, second, third]
    for (const path of paths) seed(path, '{"value":"old"}\n')
    const transaction = stageClientInstallTransaction(
      paths.map((path) => writeAsset(path, '{"value":"managed"}\n')),
      () => new Date(0),
    )
    const thirdStage = transaction.entries[2]?.stagePath
    const thirdRollback = transaction.entries[2]?.rollbackPath
    if (thirdStage === undefined || thirdRollback === undefined) {
      throw new Error('Expected third staged paths.')
    }

    // When: third promotion and its recovery fail while earlier recoveries remain available
    expect(() => commitClientInstallTransaction(transaction, {
      moveExclusive: (source, destination) => {
        if (source === thirdStage) throw new Error('third promotion failed')
        if (source === thirdRollback) throw new Error('third recovery failed')
        moveExclusive(source, destination)
      },
    })).toThrow('rollback was incomplete')

    // Then: earlier files are restored, third remains recoverable, and locks are released
    expect(readFileSync(first, 'utf8')).toBe('{"value":"old"}\n')
    expect(readFileSync(second, 'utf8')).toBe('{"value":"old"}\n')
    expect(readFileSync(thirdRollback, 'utf8')).toBe('{"value":"old"}\n')
    expect(readdirSync(directory).some((name) => name.endsWith('.lock'))).toBe(false)
  })

  test('rejects a stale planner expectation after another install replaces the source', () => {
    // Given: a planner rendered from one inode before a concurrent same-byte replacement
    const path = join(directory, 'planned.json')
    seed(path, '{"user":"preserved"}\n')
    const previous = readManagedFileSnapshot(path)
    const replacement = join(directory, 'planned-replacement.json')
    seed(replacement, '{"user":"preserved"}\n')
    renameSync(replacement, path)
    const concurrentInode = statSync(path).ino

    // When: the stale asset reaches staging with its observed-source expectation
    expect(() => stageClientInstallTransaction([{
      ...writeAsset(path, '{"managed":"stale"}\n'),
      expectation: { previous },
    }], () => new Date(0))).toThrow('changed during installation')

    // Then: the concurrent inode and contents remain with no transaction residue
    expect(statSync(path).ino).toBe(concurrentInode)
    expect(readFileSync(path, 'utf8')).toBe('{"user":"preserved"}\n')
    expect(readdirSync(directory)).toEqual(['planned.json'])
  })

  test('aborts when the same bytes and mode move to a new inode after staging', () => {
    // Given: a staged transaction whose destination is replaced behind its lock
    const path = join(directory, 'inode.json')
    seed(path, '{"value":"old"}\n')
    const transaction = stageClientInstallTransaction([
      writeAsset(path, '{"value":"managed"}\n'),
    ], () => new Date(0))
    const replacement = join(directory, 'inode-replacement.json')
    seed(replacement, '{"value":"old"}\n')
    renameSync(replacement, path)
    const concurrentInode = statSync(path).ino

    // When: commit revalidates identity in addition to bytes and mode
    expect(() => commitClientInstallTransaction(transaction)).toThrow(
      'changed during installation',
    )

    // Then: the replacement wins and all owned stage/lock files are removed
    expect(statSync(path).ino).toBe(concurrentInode)
    expect(readFileSync(path, 'utf8')).toBe('{"value":"old"}\n')
    expect(readdirSync(directory)).toEqual(['inode.json'])
  })

  test('rejects a cross-home writer that moves a concurrently committed source', () => {
    // Given: two HOME-scoped installers staged the same explicit destination
    const path = join(directory, 'shared-explicit.json')
    seed(path, '{"owner":"original"}\n')
    const first = stageClientInstallTransaction([
      writeAsset(path, '{"owner":"first"}\n'),
    ], () => new Date(0))
    const second = stageClientInstallTransaction([
      writeAsset(path, '{"owner":"second"}\n'),
    ], () => new Date(0))
    let interleaved = false

    // When: the first transaction fully commits after the second validated its snapshot
    const commitSecond = () => commitClientInstallTransaction(second, {
      moveExclusive: (source, destination) => {
        if (!interleaved && source === path) {
          interleaved = true
          commitClientInstallTransaction(first)
        }
        renameSync(source, destination)
      },
    })

    // Then: the stale writer restores the winner and preserves the original backup
    expect(commitSecond).toThrow('changed during installation')
    expect(interleaved).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('{"owner":"first"}\n')
    const names = readdirSync(directory)
    const backup = names.find((name) => name.includes('.bak'))
    expect(backup).toBeDefined()
    expect(readFileSync(join(directory, backup ?? ''), 'utf8')).toBe(
      '{"owner":"original"}\n',
    )
    expect(names.some((name) => name.includes('.tmp'))).toBe(false)
  })

  test.each([
    ['valid symlink', 'valid'],
    ['dangling symlink', 'dangling'],
    ['FIFO', 'fifo'],
  ] as const)('rejects a %s destination without reading or replacing it', (_label, kind) => {
    // Given: a non-regular managed destination
    const path = join(directory, `${kind}.json`)
    const target = join(directory, `${kind}-target.json`)
    switch (kind) {
      case 'valid':
        writeFileSync(target, 'external\n')
        chmodSync(target, 0o644)
        symlinkSync(target, path)
        break
      case 'dangling':
        symlinkSync(target, path)
        break
      case 'fifo':
        execFileSync('mkfifo', [path])
        break
    }
    const targetMode = kind === 'valid' ? statSync(target).mode & 0o777 : undefined

    // When: the generic transaction preflights the destination
    expect(() => stageClientInstallTransaction([
      writeAsset(path, '{"managed":true}\n'),
    ], () => new Date(0))).toThrow()

    // Then: the special entry and any external target remain unchanged
    switch (kind) {
      case 'valid':
        expect(lstatSync(path).isSymbolicLink()).toBe(true)
        expect(readlinkSync(path)).toBe(target)
        expect(readFileSync(target, 'utf8')).toBe('external\n')
        expect(statSync(target).mode & 0o777).toBe(targetMode)
        break
      case 'dangling':
        expect(lstatSync(path).isSymbolicLink()).toBe(true)
        expect(readlinkSync(path)).toBe(target)
        break
      case 'fifo':
        expect(lstatSync(path).isFIFO()).toBe(true)
        break
    }
  })

  test('rejects a redirected managed parent before reading or writing its target', () => {
    // Given: the immediate managed parent links to an external directory
    const external = join(directory, 'external')
    const linkedParent = join(directory, 'linked')
    mkdirSync(external)
    symlinkSync(external, linkedParent)
    const path = join(linkedParent, 'settings.json')

    // When: the transaction attempts to snapshot a leaf through that parent
    expect(() => stageClientInstallTransaction([
      writeAsset(path, '{"managed":true}\n'),
    ], () => new Date(0))).toThrow('regular file or absent')

    // Then: the link is preserved and its external target remains untouched
    expect(existsSync(join(external, 'settings.json'))).toBe(false)
    expect(lstatSync(linkedParent).isSymbolicLink()).toBe(true)
  })
})

function writeAsset(path: string, contents: string): ClientInstallAssetPlan {
  return { operation: CLIENT_INSTALL_ASSET_OPERATION.Write, path, contents }
}

function seed(path: string, contents: string): void {
  writeFileSync(path, contents)
  chmodSync(path, FILE_MODE)
}

function moveExclusive(source: string, destination: string): void {
  linkSync(source, destination)
  unlinkSync(source)
}
