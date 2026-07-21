import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

const FILE_SYSTEM_ERROR_CODE = {
  NotFound: 'ENOENT',
} as const
const PLATFORM = { MacOs: 'darwin' } as const
const TRUSTED_MACOS_PARENT_LINKS = [
  { path: '/etc', target: '/private/etc' },
  { path: '/home', target: '/System/Volumes/Data/home' },
  { path: '/tmp', target: '/private/tmp' },
  { path: '/var', target: '/private/var' },
] as const

export type ManagedFileSnapshot = {
  readonly contents: Buffer
  readonly mode: number
  readonly device: number
  readonly inode: number
}

export class ManagedFileSafetyError extends Error {
  readonly name = 'ManagedFileSafetyError'
}

export function assertManagedRegularFileOrAbsent(path: string): void {
  assertManagedParentDirectories(path)
  const status = lstatManagedPath(path)
  if (status !== undefined && !status.isFile()) throw unsafeManagedPath(path)
}

export function assertManagedParentDirectories(path: string): void {
  const ancestors: string[] = []
  let current = dirname(resolve(path))
  while (true) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const ancestor of ancestors.reverse()) {
    const status = lstatManagedPath(ancestor)
    if (status === undefined || status.isDirectory()) continue
    if (isTrustedParentDirectoryLink(ancestor, status)) continue
    throw unsafeManagedPath(ancestor)
  }
}

export function readManagedFileSnapshot(
  path: string,
): ManagedFileSnapshot | undefined {
  assertManagedParentDirectories(path)
  const status = lstatManagedPath(path)
  if (status === undefined) return undefined
  if (!status.isFile()) throw unsafeManagedPath(path)

  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const openedStatus = fstatSync(descriptor)
    if (!openedStatus.isFile()) throw unsafeManagedPath(path)
    return {
      contents: readFileSync(descriptor),
      mode: openedStatus.mode & 0o777,
      device: openedStatus.dev,
      inode: openedStatus.ino,
    }
  } finally {
    closeSync(descriptor)
  }
}

export function readManagedTextFile(path: string, absent: string): string {
  return readManagedFileSnapshot(path)?.contents.toString('utf8') ?? absent
}

export function setManagedFileMode(path: string, mode: number): void {
  assertManagedParentDirectories(path)
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    if (!fstatSync(descriptor).isFile()) throw unsafeManagedPath(path)
    fchmodSync(descriptor, mode)
  } finally {
    closeSync(descriptor)
  }
}

export function lstatManagedPath(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isFileSystemError(error) && error.code === FILE_SYSTEM_ERROR_CODE.NotFound) {
      return undefined
    }
    throw error
  }
}

export function managedPathEntryExists(path: string): boolean {
  return lstatManagedPath(path) !== undefined
}

export function sameManagedFileIdentity(
  status: Stats | undefined,
  identity: Pick<ManagedFileSnapshot, 'device' | 'inode'> | undefined,
): boolean {
  return status !== undefined && identity !== undefined && status.isFile() &&
    status.dev === identity.device && status.ino === identity.inode
}

function unsafeManagedPath(path: string): ManagedFileSafetyError {
  return new ManagedFileSafetyError(
    `Managed client asset path must be a regular file or absent: ${path}`,
  )
}

function isTrustedParentDirectoryLink(path: string, status: Stats): boolean {
  if (process.platform !== PLATFORM.MacOs || !status.isSymbolicLink()) return false
  const trusted = TRUSTED_MACOS_PARENT_LINKS.find((candidate) => candidate.path === path)
  return trusted !== undefined && realpathSync(path) === trusted.target
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
