import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import type { SsoOnboardingInput } from '../src/cli/onboarding-sso'
import { runCliProgram, type ProgramContext } from '../src/cli/program'
import { nativeTokenBoundary } from './native-lite-test-support'

const VALUE = {
  OriginA: 'https://a.example.test',
  OriginB: 'https://b.example.test',
  KeyA: 'transaction-key-a',
  KeyB: 'transaction-key-b',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-sso-transaction-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install SSO token transaction', () => {
  test('keeps client configuration when installation is cancelled after native origin-B login', async () => {
    // Given: origin A is installed and native login owns the new B credential.
    await installOriginA()
    const before = installedState()
    const fresh = freshSso(VALUE.OriginB, VALUE.KeyB, 'n')

    // When: the user rejects the B plan after authenticated resource discovery
    const result = await runOriginB(fresh)

    // Then: cancellation preserves client assets while native login remains authenticated.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('cancelled')
    expect(installedState()).toEqual(before)
    expectNativeTokenPersisted(fresh)
  })

  test('keeps origin-A state when origin-B managed plugin preparation is interrupted', async () => {
    // Given: origin A is installed before a fresh origin B login
    await installOriginA()
    const before = installedState()
    const fresh = freshSso(VALUE.OriginB, VALUE.KeyB, 'y')

    // When: managed plugin preparation is interrupted before mutable staging
    const result = await runOriginB(fresh, {
      externalSetup: true,
      managedPluginBoundary: interruptedPluginBoundary(() => {
        expect(installedState()).toEqual(before)
      }),
    })

    // Then: native authentication survives while client changes are discarded.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('interrupted')
    expect(installedState()).toEqual(before)
    expectNativeTokenPersisted(fresh)
  })

  test('preserves native login when a first install fails during plugin preparation', async () => {
    // Given: no persisted token or client state exists before origin B onboarding
    const fresh = freshSso(VALUE.OriginB, VALUE.KeyB, 'y')

    // When: plugin preparation fails after SSO and discovery complete
    const result = await runOriginB(fresh, {
      externalSetup: true,
      managedPluginBoundary: interruptedPluginBoundary(() => {
        expect(existsSync(tokenPath())).toBe(true)
      }),
    })

    // Then: only the separately completed native login remains.
    expect(result.exitCode).toBe(1)
    expect(existsSync(tokenPath())).toBe(true)
    expect(existsSync(launchPath())).toBe(false)
    expect(existsSync(openCodePath())).toBe(false)
    expectNativeTokenPersisted(fresh)
  })

  test('restores client assets without rolling back native login when promotion fails', async () => {
    // Given: origin A client state and a separately completed native B login.
    await installOriginA()
    const before = installedState()
    const fresh = freshSso(VALUE.OriginB, VALUE.KeyB, 'y')

    // When: launch promotion fails after the B token has been promoted
    const result = await runOriginB(fresh, {
      clientInstallCommitBoundary: failingLaunchPromotion(),
    })

    // Then: transaction rollback restores client state without touching the native credential.
    expect(result.exitCode).toBe(1)
    expect(installedState()).toEqual(before)
    expectNativeTokenPersisted(fresh)
  })

  test('preserves native login when a first install rolls back client promotion', async () => {
    // Given: a first origin B install with no previous token
    const fresh = freshSso(VALUE.OriginB, VALUE.KeyB, 'y')

    // When: the later launch promotion fails after token promotion
    const result = await runOriginB(fresh, {
      clientInstallCommitBoundary: failingLaunchPromotion(),
    })

    // Then: client destinations return to absence while native login remains complete.
    expect(result.exitCode).toBe(1)
    expect(existsSync(tokenPath())).toBe(true)
    expect(existsSync(launchPath())).toBe(false)
    expect(existsSync(openCodePath())).toBe(false)
    expect(homeArtifacts()).not.toContain('.rollback.tmp')
    expectNativeTokenPersisted(fresh)
  })
})

async function installOriginA(): Promise<void> {
  writeToken(VALUE.OriginA, VALUE.KeyA)
  const result = await runCliProgram(installArgs(VALUE.OriginA, true), {
    env: { HOME: homeDirectory },
    now: () => new Date(0),
    gatewayDiscovery: successfulDiscovery,
    ssoBoundaries: nativeTokenBoundary(tokenPath()),
  })
  expect(result.exitCode).toBe(0)
}

type FreshSsoFixture = {
  readonly context: ProgramContext
  readonly nativePaths: string[]
}

function freshSso(origin: string, key: string, confirmation: 'y' | 'n'): FreshSsoFixture {
  const nativePaths: string[] = []
  return {
    nativePaths,
    context: {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      onboardingIO: { isTTY: true, prompt: promptFrom(['', '', '', '', confirmation]), write: () => undefined },
      ssoBoundaries: nativeTokenBoundary(tokenPath()),
      ssoOnboarding: async (input: SsoOnboardingInput) => {
        const path = input.tokenFilePath
        if (path === undefined) throw new Error('Native token path is missing.')
        nativePaths.push(path)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, tokenSource(origin, key))
        return { status: 'authenticated' }
      },
      gatewayDiscovery: successfulDiscovery,
    },
  }
}

function runOriginB(
  fresh: FreshSsoFixture,
  overrides: Partial<ProgramContext> = {},
) {
  return runCliProgram(installArgs(VALUE.OriginB, false), {
    ...fresh.context,
    ...overrides,
  })
}

function interruptedPluginBoundary(assertState: () => void) {
  return {
    fs: { exists: () => false, isFile: () => true, remove: () => undefined },
    command: {
      run: async () => {
        assertState()
        return { exitCode: 130, stdout: '', stderr: 'interrupted' }
      },
    },
  }
}

function failingLaunchPromotion() {
  let injected = false
  return {
    moveExclusive: (source: string, destination: string) => {
      if (!injected && destination === launchPath() && source !== launchPath()) {
        injected = true
        throw new Error('injected launch promotion failure')
      }
      renameSync(source, destination)
    },
  }
}

function installedState() {
  return [launchPath(), openCodePath()].map((path) => ({
    path,
    contents: readFileSync(path),
    mode: statSync(path).mode & 0o777,
    inode: statSync(path).ino,
  }))
}

function writeToken(origin: string, key: string): void {
  mkdirSync(dirname(tokenPath()), { recursive: true })
  writeFileSync(tokenPath(), tokenSource(origin, key))
  if (process.platform !== 'win32') chmodSync(tokenPath(), 0o600)
}

function tokenSource(origin: string, key: string): string {
  return JSON.stringify({ base_url: origin, key, user_id: 'test-user', user_role: 'cli' })
}

function installArgs(origin: string, nonInteractive: boolean): readonly string[] {
  return [
    'install', '--target', 'opencode', '--base-url', origin, '--auth', 'sso',
    ...(nonInteractive ? ['--non-interactive'] : []),
    '--no-search', '--no-mcp', '--no-toolsets',
  ]
}

function tokenPath(): string { return join(homeDirectory, '.litellm', 'token.json') }
function launchPath(): string { return resolveLaunchConfigPath({ HOME: homeDirectory }) }
function openCodePath(): string { return join(homeDirectory, '.config', 'opencode', 'opencode.jsonc') }
function homeArtifacts(): string { return readdirSync(homeDirectory, { recursive: true }).join('\n') }

function expectNativeTokenPersisted(fresh: FreshSsoFixture): void {
  expect(fresh.nativePaths).toHaveLength(1)
  const nativePath = fresh.nativePaths[0]
  if (nativePath === undefined) throw new Error('Expected the native token path.')
  expect(nativePath).toBe(tokenPath())
  expect(JSON.parse(readFileSync(nativePath, 'utf8'))).toMatchObject({ base_url: VALUE.OriginB, key: VALUE.KeyB })
}

function promptFrom(answers: string[]): () => Promise<string> {
  return async () => answers.shift() ?? ''
}

async function successfulDiscovery() {
  return { models: [], searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [] }
}
