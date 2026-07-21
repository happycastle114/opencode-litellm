import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'

const MODE = {
  Install: 'install',
  Login: 'login',
  Logout: 'logout',
} as const
const VALUE = {
  OriginA: 'https://a.example.test',
  OriginB: 'https://b.example.test',
  KeyA: 'serialized-key-a',
  KeyB: 'serialized-key-b',
} as const
const FIXTURE = new URL('./fixtures/concurrent-auth-writer.ts', import.meta.url)
const NO_PATH = '-'

let homeDirectory: string
let children: ChildProcessWithoutNullStreams[]

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-auth-serialization-'))
  children = []
})

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(children.map(waitForExit))
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('shared client auth writer lease', () => {
  test('serializes different-origin installs with matching final token and launch state', async () => {
    // Given: origin A install holds the lease after persisting its SSO token
    const first = spawnWriter(MODE.Install, VALUE.OriginA, VALUE.KeyA, 'first', true)
    await waitForFile(marker('first-token'))
    const second = spawnWriter(MODE.Install, VALUE.OriginB, VALUE.KeyB, 'second')
    await waitForFile(marker('second-started'))

    // When: origin B contends before origin A is allowed to finish
    await delay(100)
    expect(existsSync(marker('second-token'))).toBe(false)
    writeFileSync(marker('first-allow'), 'continue\n')
    expect((await waitForExit(first)).code).toBe(0)
    expect((await waitForExit(second)).code).toBe(0)

    // Then: the later serialized install owns both exact-origin persisted surfaces
    expect(readToken().base_url).toBe(VALUE.OriginB)
    expect(readLaunch().openCode.gatewayOrigin).toBe(VALUE.OriginB)
  })

  test('serializes login before a different-origin install converges both surfaces', async () => {
    // Given: standalone login holds the common writer lease after writing origin A
    const login = spawnWriter(MODE.Login, VALUE.OriginA, VALUE.KeyA, 'login', true)
    await waitForFile(marker('login-token'))
    const install = spawnWriter(MODE.Install, VALUE.OriginB, VALUE.KeyB, 'install')
    await waitForFile(marker('install-started'))

    // When: the install contends while login remains inside SSO onboarding
    await delay(100)
    expect(existsSync(marker('install-token'))).toBe(false)
    writeFileSync(marker('login-allow'), 'continue\n')
    expect((await waitForExit(login)).code).toBe(0)
    expect((await waitForExit(install)).code).toBe(0)

    // Then: install runs second and persists one matching origin across token and launch
    expect(readToken().base_url).toBe(VALUE.OriginB)
    expect(readLaunch().openCode.gatewayOrigin).toBe(VALUE.OriginB)
  })

  test('prevents logout from deleting a token midway through install', async () => {
    // Given: install holds the writer lease after writing its token but before commit
    const install = spawnWriter(MODE.Install, VALUE.OriginA, VALUE.KeyA, 'install', true)
    await waitForFile(marker('install-token'))
    const logout = spawnWriter(MODE.Logout, VALUE.OriginA, VALUE.KeyB, 'logout')
    await waitForFile(marker('logout-started'))

    // When: logout contends while install is paused
    await delay(100)
    expect(existsSync(marker('logout-completed'))).toBe(false)
    expect(existsSync(join(homeDirectory, '.litellm', 'token.json'))).toBe(false)
    writeFileSync(marker('install-allow'), 'continue\n')
    expect((await waitForExit(install)).code).toBe(0)
    expect((await waitForExit(logout)).code).toBe(0)

    // Then: install commits first and the serialized explicit logout removes the token
    expect(readLaunch().openCode.gatewayOrigin).toBe(VALUE.OriginA)
    expect(existsSync(join(homeDirectory, '.litellm', 'token.json'))).toBe(false)
  })
})

function spawnWriter(
  mode: typeof MODE[keyof typeof MODE],
  origin: string,
  key: string,
  name: string,
  hold = false,
): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [
    FIXTURE.pathname,
    mode,
    homeDirectory,
    origin,
    key,
    marker(`${name}-started`),
    mode === MODE.Logout ? NO_PATH : marker(`${name}-token`),
    hold ? marker(`${name}-allow`) : NO_PATH,
    marker(`${name}-completed`),
  ])
  children.push(child)
  return child
}

function marker(name: string): string {
  return join(homeDirectory, name)
}

function readToken(): { readonly base_url: string } {
  return JSON.parse(readFileSync(join(homeDirectory, '.litellm', 'token.json'), 'utf8'))
}

function readLaunch(): { readonly openCode: { readonly gatewayOrigin: string } } {
  return JSON.parse(readFileSync(resolveLaunchConfigPath({ HOME: homeDirectory }), 'utf8'))
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await delay(10)
  }
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
