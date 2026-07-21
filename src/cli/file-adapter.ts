import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

export const CONFIG_FILE_MODE = 0o600
const DIR_MODE = 0o700
const IS_WINDOWS = process.platform === 'win32'

export type WriteConfigOptions = {
  readonly now: () => Date
}

export function writeConfigAtomic(
  path: string,
  contents: string,
  options: WriteConfigOptions,
): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, ...(IS_WINDOWS ? {} : { mode: DIR_MODE }) })

  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') === contents) {
      if (!IS_WINDOWS) chmodSync(path, CONFIG_FILE_MODE)
      return
    }
    backupExisting(path, options.now())
  }

  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, contents, IS_WINDOWS ? {} : { mode: CONFIG_FILE_MODE })
  renameSync(temp, path)
  if (!IS_WINDOWS) chmodSync(path, CONFIG_FILE_MODE)
}

export function retireConfigFile(
  path: string,
  options: WriteConfigOptions,
): string | undefined {
  if (!existsSync(path)) return undefined
  const backup = resolveConfigBackupPath(path, options.now())
  renameSync(path, backup)
  if (!IS_WINDOWS) chmodSync(backup, CONFIG_FILE_MODE)
  return backup
}

function backupExisting(path: string, now: Date): void {
  const previous = readFileSync(path)
  const backup = resolveConfigBackupPath(path, now)
  writeFileSync(backup, previous, IS_WINDOWS ? {} : { mode: CONFIG_FILE_MODE })
}

export function resolveConfigBackupPath(path: string, now: Date): string {
  const base = `${path}.${stamp(now)}.bak`
  let backup = base
  let suffix = 1
  while (existsSync(backup)) {
    backup = `${base}.${suffix}`
    suffix += 1
  }
  return backup
}

function stamp(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}`
}
