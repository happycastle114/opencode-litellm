import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireClientInstallPlanningLock,
  releaseClientInstallPlanningLock,
  resolveClientInstallPlanningLockPath,
  withClientInstallPlanningLock,
} from '../src/cli/client-install-planning-lock'

const LOCK_MODULE = new URL(
  '../src/cli/client-install-planning-lock.ts',
  import.meta.url,
).href
const CHILD_MARKER = {
  Acquired: 'ACQUIRED',
  Attempting: 'ATTEMPTING',
} as const

let directory: string | undefined
let child: ChildProcessWithoutNullStreams | undefined

afterEach(async () => {
  if (child !== undefined && child.exitCode === null) child.kill('SIGKILL')
  if (child !== undefined) await childExit(child)
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  child = undefined
  directory = undefined
})

describe('client installation global lease', () => {
  test('serializes a second installer process until the active lease releases', async () => {
    // Given: this process owns the home-scoped installation lease
    directory = mkdtempSync(join(tmpdir(), 'client-install-lease-'))
    const first = await acquireClientInstallPlanningLock(directory)
    child = spawnLeaseChild(directory)
    await waitForOutput(child.stderr, CHILD_MARKER.Attempting)

    // When: the second process is allowed to contend before the first releases
    await delay(100)
    expect(readAvailable(child.stdout)).not.toContain(CHILD_MARKER.Acquired)
    await releaseClientInstallPlanningLock(first)
    const stdout = await readToExit(child)

    // Then: it acquires only after release and leaves no lock directory behind
    expect(stdout).toContain(CHILD_MARKER.Acquired)
    expect((await childExit(child)).code).toBe(0)
    expect(existsSync(lockPath(directory))).toBe(false)
  })

  test('refreshes an active interactive lease beyond its stale window', async () => {
    // Given: a writer holds the lease longer than the configured stale threshold
    directory = mkdtempSync(join(tmpdir(), 'client-install-heartbeat-'))
    const first = await acquireClientInstallPlanningLock(directory)
    const path = lockPath(directory)
    const initialMtime = statSync(path).mtimeMs
    await delay(11_000)

    // When: a second process contends after the original mtime would be stale
    child = spawnLeaseChild(directory)
    await waitForOutput(child.stderr, CHILD_MARKER.Attempting)
    await delay(100)

    // Then: the heartbeat advanced mtime and the active writer still excludes it
    expect(statSync(path).mtimeMs).toBeGreaterThan(initialMtime)
    expect(readAvailable(child.stdout)).not.toContain(CHILD_MARKER.Acquired)
    await releaseClientInstallPlanningLock(first)
    expect(await readToExit(child)).toContain(CHILD_MARKER.Acquired)
    expect((await childExit(child)).code).toBe(0)
  }, 15_000)

  test('recovers a stale lease left by a process killed without cleanup', async () => {
    // Given: a child owns the lease and is killed before its release callback runs
    directory = mkdtempSync(join(tmpdir(), 'client-install-stale-'))
    child = spawnLeaseChild(directory, false)
    await waitForOutput(child.stdout, CHILD_MARKER.Acquired)
    child.kill('SIGKILL')
    await childExit(child)
    const path = lockPath(directory)
    expect(existsSync(path)).toBe(true)
    const staleTime = new Date(Date.now() - 60_000)
    utimesSync(path, staleTime, staleTime)

    // When: a later installer acquires through proper-lockfile stale recovery
    const recovered = await acquireClientInstallPlanningLock(directory)
    await releaseClientInstallPlanningLock(recovered)

    // Then: the crashed lease no longer strands installation
    expect(existsSync(path)).toBe(false)
  })

  test('reports release failure without undoing a completed operation', async () => {
    // Given: a completed write followed by foreign contents replacing the lease directory
    directory = mkdtempSync(join(tmpdir(), 'client-install-release-'))
    const committedPath = join(directory, 'committed.json')
    const path = lockPath(directory)

    // When: lease release cannot remove the foreign non-empty directory
    const operation = withClientInstallPlanningLock(directory, async () => {
      writeFileSync(committedPath, '{"committed":true}\n')
      rmSync(path, { recursive: true })
      mkdirSync(path)
      writeFileSync(join(path, 'foreign'), 'preserve\n')
      return 'committed'
    })

    // Then: release is reported separately and committed bytes are untouched
    await expect(operation).rejects.toThrow('lease release failed')
    expect(readFileSync(committedPath, 'utf8')).toBe('{"committed":true}\n')
    expect(readFileSync(join(path, 'foreign'), 'utf8')).toBe('preserve\n')
  })

  test('reports a compromised lease without an uncaught asynchronous throw', async () => {
    // Given: another actor changes the active lease mtime behind proper-lockfile
    directory = mkdtempSync(join(tmpdir(), 'client-install-compromised-'))
    const lease = await acquireClientInstallPlanningLock(directory)
    const path = lockPath(directory)
    const foreignTime = new Date(Date.now() + 60_000)
    utimesSync(path, foreignTime, foreignTime)

    // When: the heartbeat detects that this process no longer owns the lease
    await waitForCompromise(lease.compromised)

    // Then: release reports the compromised lease and preserves the foreign entry
    await expect(releaseClientInstallPlanningLock(lease)).rejects.toThrow(
      'lease was compromised',
    )
    expect(existsSync(path)).toBe(true)
  })
})

function spawnLeaseChild(
  homeDirectory: string,
  release = true,
): ChildProcessWithoutNullStreams {
  const script = [
    `const api = await import(${JSON.stringify(LOCK_MODULE)})`,
    `process.stderr.write(${JSON.stringify(`${CHILD_MARKER.Attempting}\n`)})`,
    `const lease = await api.acquireClientInstallPlanningLock(${JSON.stringify(homeDirectory)})`,
    `process.stdout.write(${JSON.stringify(`${CHILD_MARKER.Acquired}\n`)})`,
    release
      ? 'await api.releaseClientInstallPlanningLock(lease)'
      : 'await new Promise(() => {})',
  ].join(';')
  return spawn(process.execPath, ['--eval', script])
}

function lockPath(homeDirectory: string): string {
  return resolveClientInstallPlanningLockPath(realpathSync(homeDirectory))
}

async function waitForOutput(
  stream: NodeJS.ReadableStream,
  expected: string,
): Promise<void> {
  let output = ''
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      `Timed out waiting for child output: ${expected}`,
    )), 5_000)
    stream.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
      if (!output.includes(expected)) return
      clearTimeout(timeout)
      resolve()
    })
  })
}

function readAvailable(stream: NodeJS.ReadableStream): string {
  const chunk = stream.read() as Buffer | string | null
  return chunk?.toString() ?? ''
}

async function readToExit(process: ChildProcessWithoutNullStreams): Promise<string> {
  let output = readAvailable(process.stdout)
  process.stdout.on('data', (chunk: Buffer | string) => {
    output += chunk.toString()
  })
  await childExit(process)
  return output
}

function childExit(
  process: ChildProcessWithoutNullStreams,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return Promise.resolve({ code: process.exitCode, signal: process.signalCode })
  }
  return new Promise((resolve) => {
    process.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForCompromise(
  compromised: () => Error | undefined,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (compromised() === undefined) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for lease compromise')
    await delay(10)
  }
}
