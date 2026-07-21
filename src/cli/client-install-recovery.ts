import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ClientInstallAssetPlan } from './client-install-assets'
import { lstatManagedPath } from './managed-file-safety'

const RECOVERY_SUFFIX = '.rollback.tmp' as const
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function findClientInstallRecoveryFiles(
  assets: readonly ClientInstallAssetPlan[],
): readonly string[] {
  const recoveryFiles = new Set<string>()
  for (const asset of assets) {
    const directory = dirname(asset.path)
    const prefix = `${basename(asset.path)}.`
    for (const name of readDirectory(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith(RECOVERY_SUFFIX)) continue
      const transactionId = name.slice(prefix.length, -RECOVERY_SUFFIX.length)
      if (!UUID_PATTERN.test(transactionId)) continue
      const path = join(directory, name)
      if (lstatManagedPath(path)?.isFile()) recoveryFiles.add(path)
    }
  }
  return [...recoveryFiles].sort()
}

export function formatClientInstallRecoveryWarning(path: string): string {
  return `Recovery file from an interrupted client install remains at ${path}; verify the active destination before removing it.`
}

function readDirectory(path: string): readonly string[] {
  try { return readdirSync(path) } catch { return [] }
}
