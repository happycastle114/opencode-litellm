import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENT_INSTALL_ASSET_OPERATION } from '../../src/cli/client-install-assets'
import { stageAndCommitClientInstallTransactionWithLeases } from '../../src/cli/client-install-transaction-lease'
import { withClientInstallPlanningLock } from '../../src/cli/client-install-planning-lock'
import { readManagedFileSnapshot } from '../../src/cli/managed-file-safety'

const [homeDirectory, destination, contents, writerName, barrierDirectory] =
  process.argv.slice(2)
if (homeDirectory === undefined || destination === undefined || contents === undefined ||
  writerName === undefined || barrierDirectory === undefined) {
  throw new Error('Cross-home transaction writer arguments are incomplete.')
}

const result = await withClientInstallPlanningLock(homeDirectory, async () => {
  const previous = readManagedFileSnapshot(destination)
  writeFileSync(join(barrierDirectory, `${writerName}-snapshotted`), 'snapshotted\n')
  await waitForFile(join(barrierDirectory, 'release-writers'))
  try {
    await stageAndCommitClientInstallTransactionWithLeases({
      assets: [{
        operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
        path: destination,
        contents,
        expectation: { previous },
      }],
      guards: [],
      now: () => new Date(0),
    })
    return { exitCode: 0, stderr: '' }
  } catch (error) {
    return {
      exitCode: 1,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
})

process.stdout.write(JSON.stringify(result))
process.exitCode = result.exitCode

async function waitForFile(path: string): Promise<void> {
  while (!existsSync(path)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
