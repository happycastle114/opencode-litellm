import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'

const VALUE = {
  OriginA: 'https://cross-home-a.example.test',
  OriginB: 'https://cross-home-b.example.test',
  KeyA: 'cross-home-key-a',
  KeyB: 'cross-home-key-b',
} as const
const FIXTURE = new URL('./fixtures/cross-home-shared-writer.ts', import.meta.url)
const TRANSACTION_FIXTURE = new URL(
  './fixtures/cross-home-shared-transaction-writer.ts',
  import.meta.url,
)

type TransactionWriterOptions = {
  readonly home: string
  readonly sharedConfig: string
  readonly contents: string
  readonly name: string
  readonly barrier: string
}

let directory: string
let children: ChildProcessWithoutNullStreams[]

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'client-cross-home-'))
  children = []
})

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(children.map(readChild))
  rmSync(directory, { recursive: true, force: true })
})

describe('cross-home explicit destination transaction', () => {
  test('serializes writers after both snapshot the original and before either mutates it', async () => {
    // Given: different HOME locks and two explicit writers snapshot one original
    const homeA = join(directory, 'transaction-home-a')
    const homeB = join(directory, 'transaction-home-b')
    const sharedConfig = join(directory, 'transaction-shared', 'settings.json')
    const barrier = join(directory, 'transaction-barrier')
    mkdirSync(homeA)
    mkdirSync(homeB)
    mkdirSync(barrier)
    mkdirSync(dirname(sharedConfig), { recursive: true })
    const original = '{"owner":"original"}\n'
    const contents = {
      a: '{"owner":"a"}\n',
      b: '{"owner":"b"}\n',
    } as const
    writeFileSync(sharedConfig, original)
    const writerA = spawnTransactionWriter({
      home: homeA,
      sharedConfig,
      contents: contents.a,
      name: 'a',
      barrier,
    })
    const writerB = spawnTransactionWriter({
      home: homeB,
      sharedConfig,
      contents: contents.b,
      name: 'b',
      barrier,
    })
    await Promise.all([
      waitForFile(join(barrier, 'a-snapshotted')),
      waitForFile(join(barrier, 'b-snapshotted')),
    ])

    // When: both pre-mutation snapshots are released to contend together
    expect(readFileSync(sharedConfig, 'utf8')).toBe(original)
    writeFileSync(join(barrier, 'release-writers'), 'continue\n')
    const results = await Promise.all([readChild(writerA), readChild(writerB)])

    // Then: exactly one commits, the stale writer fails, and all artifacts converge
    const winnerIndex = results.findIndex(({ result }) => result.exitCode === 0)
    expect(results.filter(({ result }) => result.exitCode === 0)).toHaveLength(1)
    expect(results.filter(({ result }) => result.exitCode === 1)).toHaveLength(1)
    expect(results.find(({ result }) => result.exitCode === 1)?.result.stderr).toContain(
      'changed during installation',
    )
    expect(readFileSync(sharedConfig, 'utf8')).toBe(
      winnerIndex === 0 ? contents.a : contents.b,
    )
    const names = readdirSync(dirname(sharedConfig))
    const backups = names.filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = backups[0]
    if (backup === undefined) throw new Error('Expected the original backup.')
    expect(readFileSync(join(dirname(sharedConfig), backup), 'utf8')).toBe(original)
    expect(names.some((name) => name.includes('.tmp') || name.endsWith('.lock'))).toBe(false)
  })

  test('rejects the stale writer without overwriting the winner or original backup', async () => {
    // Given: different HOME values target one existing explicit OpenCode config
    const homeA = join(directory, 'home-a')
    const homeB = join(directory, 'home-b')
    const sharedConfig = join(directory, 'shared', 'opencode.jsonc')
    const barrier = join(directory, 'barrier')
    mkdirSync(homeA)
    mkdirSync(homeB)
    mkdirSync(barrier)
    mkdirSync(dirname(sharedConfig), { recursive: true })
    const original = '{\n  "original": true\n}\n'
    writeFileSync(sharedConfig, original)

    // When: A holds destination leases while B stages the same original and contends
    const writerA = spawnWriter(homeA, sharedConfig, VALUE.OriginA, VALUE.KeyA, 'a', barrier)
    await waitForFile(join(barrier, 'a-entered'))
    const writerB = spawnWriter(homeB, sharedConfig, VALUE.OriginB, VALUE.KeyB, 'b', barrier)
    await waitForFile(join(barrier, 'b-started'))
    await delay(200)
    expect(existsSync(join(barrier, 'b-entered'))).toBe(false)
    writeFileSync(join(barrier, 'allow-a'), 'continue\n')
    const [a, b] = await Promise.all([readChild(writerA), readChild(writerB)])

    // Then: A wins, B fails closed, and the sole backup retains the original
    expect(a.result.exitCode).toBe(0)
    expect(b.result.exitCode).toBe(1)
    expect(b.result.stderr).toContain('changed during installation')
    const sharedSource = readFileSync(sharedConfig, 'utf8')
    expect(sharedSource).toContain(VALUE.OriginA)
    expect(sharedSource).not.toContain(VALUE.OriginB)
    expect(readLaunch(homeA).openCode.gatewayOrigin).toBe(VALUE.OriginA)
    expect(existsSync(resolveLaunchConfigPath({ HOME: homeB }))).toBe(false)
    const backups = readdirSync(dirname(sharedConfig)).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = backups[0]
    if (backup === undefined) throw new Error('Expected the original backup.')
    expect(readFileSync(join(dirname(sharedConfig), backup), 'utf8')).toBe(original)
    expect(recursiveNames(directory).some((name) => name.includes('.rollback.tmp'))).toBe(false)
  })
})

function spawnTransactionWriter(
  options: TransactionWriterOptions,
): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [
    TRANSACTION_FIXTURE.pathname,
    options.home,
    options.sharedConfig,
    options.contents,
    options.name,
    options.barrier,
  ])
  children.push(child)
  return child
}

function spawnWriter(
  home: string,
  sharedConfig: string,
  origin: string,
  key: string,
  name: string,
  barrier: string,
): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [
    FIXTURE.pathname, home, sharedConfig, origin, key, name, barrier,
  ])
  children.push(child)
  return child
}

async function readChild(child: ChildProcessWithoutNullStreams): Promise<{
  readonly result: { readonly exitCode: number; readonly stderr: string }
  readonly processCode: number | null
}> {
  if (child.exitCode !== null && child.stdout.readableEnded) {
    return { result: JSON.parse(child.stdout.read()?.toString() ?? '{}'), processCode: child.exitCode }
  }
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
  const processCode = await new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
  })
  return { result: JSON.parse(stdout), processCode }
}

function readLaunch(home: string) {
  return JSON.parse(readFileSync(resolveLaunchConfigPath({ HOME: home }), 'utf8'))
}

function recursiveNames(path: string): readonly string[] {
  return readdirSync(path, { recursive: true }).map((entry) => entry.toString())
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await delay(10)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
