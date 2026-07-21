import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTO_ROUTER_PIN,
  AUTO_ROUTER_LIFECYCLE_COMMAND,
  AutoRouterError,
  AutoRouterErrorCode,
  AutoRouterMode,
  AutoRouterOperation,
  AutoRouterPlatform,
  applyAutoRouter,
  createNodeAutoRouterBoundary,
  formatAutoRouterPlan,
  planAutoRouter,
  preflightAutoRouter,
  type AutoRouterBoundary,
} from '../src/cli/auto-router'

const VALUE = {
  ApiKey: 'sk-auto-router-test-secret',
  GatewayOrigin: 'https://gateway.example.test',
} as const

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opencode-litellm-auto-router-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Auto Router plan', () => {
  test('produces a secret-free pinned dry-run without executing commands', () => {
    // Given: a dry-run selection and a boundary that records execution
    const plan = planAutoRouter(AutoRouterMode.DryRun, root, AutoRouterPlatform.Linux)
    let calls = 0
    const boundary: AutoRouterBoundary = {
      isTTY: false,
      run: () => {
        calls += 1
        return { status: 0, signal: null, stdout: '', stderr: '' }
      },
    }

    // When: both execution phases receive the dry-run plan
    preflightAutoRouter(plan, execution(), boundary)
    applyAutoRouter(plan, execution(), boundary)

    // Then: the complete plan is inspectable without a process or credential
    expect(plan.commands.map((command) => command.operation)).toEqual([
      AutoRouterOperation.RuntimeVersion,
      AutoRouterOperation.CliVersion,
      AutoRouterOperation.ConfigureHelp,
      AutoRouterOperation.Configure,
    ])
    expect(plan.commands[1]?.args).toContain(AUTO_ROUTER_PIN.Requirement)
    expect(plan.configPath).toBe(join(root, '.litellm', 'autorouter', 'config.yaml'))
    expect(calls).toBe(0)
    expect(JSON.stringify(plan)).not.toContain(VALUE.ApiKey)
    expect(formatAutoRouterPlan(plan)).not.toContain(VALUE.ApiKey)
    expect(formatAutoRouterPlan(plan)).toContain("'litellm[proxy]==1.94.0rc1'")
    expect(AUTO_ROUTER_LIFECYCLE_COMMAND.Up).toContain(
      "--from 'litellm[proxy]==1.94.0rc1' lite autoroute up",
    )
    expect(AUTO_ROUTER_LIFECYCLE_COMMAND.Down).toContain(
      "--from 'litellm[proxy]==1.94.0rc1' lite autoroute down",
    )
  })
})

describe('official Auto Router CLI boundary', () => {
  test('rejects configure without a TTY before invoking uv', () => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Linux)
    let calls = 0
    const boundary: AutoRouterBoundary = {
      isTTY: false,
      run: () => {
        calls += 1
        return { status: 0, signal: null, stdout: '', stderr: '' }
      },
    }

    const error = captureError(() => preflightAutoRouter(plan, execution(), boundary))

    expect(error).toBeInstanceOf(AutoRouterError)
    if (!(error instanceof AutoRouterError)) return
    expect(error.code).toBe(AutoRouterErrorCode.TtyRequired)
    expect(calls).toBe(0)
  })

  test.each([
    [AutoRouterOperation.RuntimeVersion, 'uv 0.10.8\n', AutoRouterErrorCode.RuntimeVersion],
    [AutoRouterOperation.CliVersion, 'LiteLLM Proxy CLI Version: 1.93.0\n', AutoRouterErrorCode.CliVersion],
    [AutoRouterOperation.ConfigureHelp, '', AutoRouterErrorCode.ConfigureUnavailable],
  ] as const)('fails closed when the %s contract cannot be verified', (
    failedOperation,
    failedOutput,
    expectedCode,
  ) => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Linux)
    const boundary: AutoRouterBoundary = {
      isTTY: true,
      run: (invocation) => {
        if (invocation.operation === failedOperation) {
          return {
            status: failedOperation === AutoRouterOperation.ConfigureHelp ? 2 : 0,
            signal: null,
            stdout: failedOutput,
            stderr: VALUE.ApiKey,
          }
        }
        return successfulVerification(invocation.operation)
      },
    }

    const error = captureError(() => preflightAutoRouter(plan, execution(), boundary))

    expect(error).toBeInstanceOf(AutoRouterError)
    if (!(error instanceof AutoRouterError)) return
    expect(error.code).toBe(expectedCode)
    expect(error.message).not.toContain(VALUE.ApiKey)
  })

  test.each([
    [AutoRouterOperation.RustCompilerVersion, AutoRouterErrorCode.RustCompilerUnavailable],
    [AutoRouterOperation.CargoVersion, AutoRouterErrorCode.CargoUnavailable],
  ] as const)('fails fast on Darwin when %s is unavailable', (
    failedOperation,
    expectedCode,
  ) => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Darwin)
    const calls: AutoRouterOperation[] = []
    const boundary: AutoRouterBoundary = {
      isTTY: true,
      run: (invocation) => {
        calls.push(invocation.operation)
        return invocation.operation === failedOperation
          ? { status: null, signal: null, stdout: '', stderr: VALUE.ApiKey, error: true }
          : successfulVerification(invocation.operation)
      },
    }

    const error = captureError(() => preflightAutoRouter(plan, execution(), boundary))

    expect(error).toBeInstanceOf(AutoRouterError)
    if (!(error instanceof AutoRouterError)) return
    expect(error.code).toBe(expectedCode)
    expect(error.message).toContain('non-Linux')
    expect(error.message).not.toContain(VALUE.ApiKey)
    expect(calls).not.toContain(AutoRouterOperation.CliVersion)
  })

  test('checks both Darwin Rust tools before resolving the official CLI', () => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Darwin)
    const calls: AutoRouterOperation[] = []
    const boundary: AutoRouterBoundary = {
      isTTY: true,
      run: (invocation) => {
        calls.push(invocation.operation)
        return successfulVerification(invocation.operation)
      },
    }

    preflightAutoRouter(plan, execution(), boundary)

    expect(calls).toEqual([
      AutoRouterOperation.RuntimeVersion,
      AutoRouterOperation.RustCompilerVersion,
      AutoRouterOperation.CargoVersion,
      AutoRouterOperation.CliVersion,
      AutoRouterOperation.ConfigureHelp,
    ])
  })

  test('does not require Rust tools on the Linux wheel path', () => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Linux)

    expect(plan.commands.map((command) => command.operation)).toEqual([
      AutoRouterOperation.RuntimeVersion,
      AutoRouterOperation.CliVersion,
      AutoRouterOperation.ConfigureHelp,
      AutoRouterOperation.Configure,
    ])
  })

  test('requires the source-build Rust preflight on Windows', () => {
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Windows)

    expect(plan.commands.slice(0, 3).map((command) => command.operation)).toEqual([
      AutoRouterOperation.RuntimeVersion,
      AutoRouterOperation.RustCompilerVersion,
      AutoRouterOperation.CargoVersion,
    ])
  })

  test('uses fake uv and lite with an isolated HOME and a process-scoped credential', () => {
    // Given: fake uv/lite executables and no pre-existing LiteLLM config
    const bin = join(root, 'bin')
    const logPath = join(root, 'lite-calls.jsonl')
    mkdirSync(bin, { recursive: true })
    writeExecutable(join(bin, 'uv'), fakeUvSource())
    writeExecutable(join(bin, 'lite'), fakeLiteSource())
    const plan = planAutoRouter(AutoRouterMode.Configure, root, AutoRouterPlatform.Linux)
    const context = execution({
      HOME: root,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_LITE_LOG: logPath,
    })
    const boundary = createNodeAutoRouterBoundary({ isTTY: true })

    // When: preflight and configuration run through the real subprocess adapter
    preflightAutoRouter(plan, context, boundary)
    applyAutoRouter(plan, context, boundary)

    // Then: only the official config owns the key; commands and logs remain secret-free
    const calls = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(calls.map((call) => call.args)).toEqual([
      ['--version'],
      ['autoroute', 'configure', '--help'],
      ['autoroute', 'configure'],
    ])
    expect(calls.every((call) => call.apiKeyPresent === true)).toBe(true)
    expect(readFileSync(logPath, 'utf8')).not.toContain(VALUE.ApiKey)
    expect(calls.flatMap((call) => call.args)).not.toContain(VALUE.ApiKey)
    expect(readFileSync(plan.configPath, 'utf8')).toContain(VALUE.ApiKey)
    expect(statSync(plan.configPath).mode & 0o777).toBe(0o600)
    expect(plan.configPath.startsWith(root)).toBe(true)
  })
})

function successfulVerification(operation: AutoRouterOperation) {
  switch (operation) {
    case AutoRouterOperation.RuntimeVersion:
      return { status: 0, signal: null, stdout: 'uv 0.10.9\n', stderr: '' }
    case AutoRouterOperation.RustCompilerVersion:
      return { status: 0, signal: null, stdout: 'rustc 1.94.0\n', stderr: '' }
    case AutoRouterOperation.CargoVersion:
      return { status: 0, signal: null, stdout: 'cargo 1.94.0\n', stderr: '' }
    case AutoRouterOperation.CliVersion:
      return {
        status: 0,
        signal: null,
        stdout: 'LiteLLM Proxy CLI Version: 1.94.0rc1\n',
        stderr: '',
      }
    case AutoRouterOperation.ConfigureHelp:
    case AutoRouterOperation.Configure:
      return { status: 0, signal: null, stdout: '', stderr: '' }
    default:
      return { status: 1, signal: null, stdout: '', stderr: '' }
  }
}

function captureError(operation: () => void): unknown {
  try {
    operation()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

function execution(
  environment: Readonly<Record<string, string | undefined>> = { HOME: root },
) {
  return {
    baseUrl: VALUE.GatewayOrigin,
    apiKey: VALUE.ApiKey,
    environment,
  }
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source, { mode: 0o700 })
  chmodSync(path, 0o700)
}

function fakeUvSource(): string {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('uv 0.10.9 (fake)\\n')
  process.exit(0)
}
const liteIndex = args.indexOf('lite')
if (liteIndex < 0) process.exit(64)
const child = spawnSync('lite', args.slice(liteIndex + 1), { env: process.env, stdio: 'inherit' })
process.exit(child.status ?? 1)
`
}

function fakeLiteSource(): string {
  return `#!/usr/bin/env node
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_LITE_LOG, JSON.stringify({
  args,
  apiKeyPresent: Boolean(process.env.LITELLM_PROXY_API_KEY),
  proxyUrl: process.env.LITELLM_PROXY_URL,
  home: process.env.HOME,
}) + '\\n')
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('LiteLLM Proxy CLI Version: 1.94.0rc1\\n')
  process.exit(0)
}
if (args.join(' ') === 'autoroute configure --help') process.exit(0)
if (args.join(' ') !== 'autoroute configure') process.exit(64)
const directory = join(process.env.HOME, '.litellm', 'autorouter')
const configPath = join(directory, 'config.yaml')
mkdirSync(directory, { recursive: true })
writeFileSync(configPath, 'provider_api_key: ' + process.env.LITELLM_PROXY_API_KEY + '\\n', { mode: 0o600 })
chmodSync(configPath, 0o600)
`
}
