import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLIENT_INSTALL_ASSET_OPERATION, CLIENT_INSTALL_BACKUP_POLICY } from '../src/cli/client-install-assets'
import { resolveClientInstallDestinationLockPath } from '../src/cli/client-install-destination-lock'
import { stageAndCommitClientInstallTransactionWithLeases } from '../src/cli/client-install-transaction-lease'
import {
  CLIENT_INSTALL_TRANSACTION_STATE,
  CLIENT_INSTALL_TRANSACTION_WARNING,
} from '../src/cli/client-install-transaction-state'

const FILE_MODE = 0o640
let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'client-install-post-commit-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('client install post-commit cleanup', () => {
  test('keeps committed destinations when rollback cleanup fails after commit', async () => {
    // Given: a leased update whose original must remain at its rollback path
    const path = join(directory, 'cleanup-warning.json')
    seed(path, '{"value":"old"}\n')
    const secrets = ['rollback-cleanup-secret', 'staging-cleanup-secret'] as const

    // When: the post-commit rollback-file cleanup reports an injected filesystem fault
    const result = await stageAndCommitClientInstallTransactionWithLeases({
      assets: [{
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path,
        contents: '{"value":"new"}\n',
        backup: CLIENT_INSTALL_BACKUP_POLICY.None,
      }],
      guards: [],
      now: () => new Date(0),
      commitBoundary: {
        moveExclusive,
        discardRollbackFiles: () => {
          throw new Error(`injected rollback cleanup failure: ${secrets[0]}`)
        },
        cleanupTransaction: () => {
          throw new Error(`injected staging cleanup failure: ${secrets[1]}`)
        },
      },
    })

    // Then: data is committed, warning text is fixed/secret-safe, and the lease is released
    expect(readFileSync(path, 'utf8')).toBe('{"value":"new"}\n')
    expect(result.transaction.state).toBe(CLIENT_INSTALL_TRANSACTION_STATE.Committed)
    expect(result.warnings).toEqual([
      CLIENT_INSTALL_TRANSACTION_WARNING.RollbackCleanup,
      CLIENT_INSTALL_TRANSACTION_WARNING.StagingCleanup,
    ])
    for (const secret of secrets) expect(JSON.stringify(result.warnings)).not.toContain(secret)
    expect(existsSync(resolveClientInstallDestinationLockPath(path))).toBe(false)
    const rollbackPath = result.transaction.entries[0]?.rollbackPath
    if (rollbackPath === undefined) throw new Error('Expected a rollback path.')
    expect(existsSync(rollbackPath)).toBe(true)
  })
})

function seed(path: string, contents: string): void {
  writeFileSync(path, contents)
  chmodSync(path, FILE_MODE)
}

function moveExclusive(source: string, destination: string): void {
  linkSync(source, destination)
  unlinkSync(source)
}
