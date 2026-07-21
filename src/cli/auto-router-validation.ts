import {
  AUTO_ROUTER_PIN,
  AutoRouterOperation,
  type AutoRouterOperation as AutoRouterOperationValue,
  type AutoRouterPlannedCommand,
} from './auto-router-contracts'

export const AutoRouterErrorCode = {
  TtyRequired: 'tty-required',
  RuntimeUnavailable: 'runtime-unavailable',
  RuntimeVersion: 'runtime-version',
  RustCompilerUnavailable: 'rust-compiler-unavailable',
  CargoUnavailable: 'cargo-unavailable',
  CliVersion: 'cli-version',
  ConfigureUnavailable: 'configure-unavailable',
  ConfigureFailed: 'configure-failed',
  InvariantViolation: 'invariant-violation',
} as const
export type AutoRouterErrorCode =
  (typeof AutoRouterErrorCode)[keyof typeof AutoRouterErrorCode]

export type AutoRouterProcessResult = {
  readonly status: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: unknown
}

export class AutoRouterError extends Error {
  readonly name = 'AutoRouterError'

  constructor(readonly code: AutoRouterErrorCode, message: string) {
    super(message)
  }
}

export function validateAutoRouterPreflight(
  command: AutoRouterPlannedCommand,
  result: AutoRouterProcessResult,
): void {
  if (!succeeded(result)) throw commandFailure(command.operation)
  switch (command.operation) {
    case AutoRouterOperation.RuntimeVersion:
      assertUvVersion(result.stdout)
      return
    case AutoRouterOperation.RustCompilerVersion:
      assertRustCompilerVersion(result.stdout)
      return
    case AutoRouterOperation.CargoVersion:
      assertCargoVersion(result.stdout)
      return
    case AutoRouterOperation.CliVersion:
      assertCliVersion(result.stdout)
      return
    case AutoRouterOperation.ConfigureHelp:
      return
    case AutoRouterOperation.Configure:
      throw autoRouterInvariantViolation()
    default:
      return assertNever(command.operation)
  }
}

export function autoRouterInvariantViolation(): AutoRouterError {
  return new AutoRouterError(
    AutoRouterErrorCode.InvariantViolation,
    'Auto Router execution plan is invalid.',
  )
}

function assertUvVersion(output: string): void {
  const version = readVersion(output, /^uv\s+(\d+)\.(\d+)\.(\d+)/m)
  const minimum = AUTO_ROUTER_PIN.MinimumUvVersion.split('.').map(Number)
  if (version === undefined || compareVersion(version, minimum) < 0) {
    throw new AutoRouterError(
      AutoRouterErrorCode.RuntimeVersion,
      `LiteLLM Auto Router requires uv ${AUTO_ROUTER_PIN.MinimumUvVersion} or newer.`,
    )
  }
}

function assertCliVersion(output: string): void {
  const match = /LiteLLM Proxy CLI Version:\s*([^\s]+)/m.exec(output)
  if (match?.[1] !== AUTO_ROUTER_PIN.CliVersion) {
    throw new AutoRouterError(
      AutoRouterErrorCode.CliVersion,
      `Pinned LiteLLM CLI version ${AUTO_ROUTER_PIN.CliVersion} could not be verified.`,
    )
  }
}

function assertRustCompilerVersion(output: string): void {
  if (!/^rustc\s+\d+\.\d+\.\d+/m.test(output)) throw rustCompilerUnavailable()
}

function assertCargoVersion(output: string): void {
  if (!/^cargo\s+\d+\.\d+\.\d+/m.test(output)) throw cargoUnavailable()
}

function commandFailure(operation: AutoRouterOperationValue): AutoRouterError {
  switch (operation) {
    case AutoRouterOperation.RuntimeVersion:
      return new AutoRouterError(
        AutoRouterErrorCode.RuntimeUnavailable,
        `LiteLLM Auto Router requires uv ${AUTO_ROUTER_PIN.MinimumUvVersion} or newer on PATH.`,
      )
    case AutoRouterOperation.RustCompilerVersion:
      return rustCompilerUnavailable()
    case AutoRouterOperation.CargoVersion:
      return cargoUnavailable()
    case AutoRouterOperation.CliVersion:
      return new AutoRouterError(
        AutoRouterErrorCode.CliVersion,
        `Pinned LiteLLM CLI version ${AUTO_ROUTER_PIN.CliVersion} could not be verified.`,
      )
    case AutoRouterOperation.ConfigureHelp:
      return new AutoRouterError(
        AutoRouterErrorCode.ConfigureUnavailable,
        'The pinned LiteLLM CLI does not expose autoroute configure.',
      )
    case AutoRouterOperation.Configure:
      return new AutoRouterError(
        AutoRouterErrorCode.ConfigureFailed,
        'the official LiteLLM Auto Router wizard did not complete.',
      )
    default:
      return assertNever(operation)
  }
}

function rustCompilerUnavailable(): AutoRouterError {
  return new AutoRouterError(
    AutoRouterErrorCode.RustCompilerUnavailable,
    'LiteLLM Auto Router requires rustc on PATH on non-Linux platforms because the pinned official package publishes Linux wheels only.',
  )
}

function cargoUnavailable(): AutoRouterError {
  return new AutoRouterError(
    AutoRouterErrorCode.CargoUnavailable,
    'LiteLLM Auto Router requires cargo on PATH on non-Linux platforms because the pinned official package publishes Linux wheels only.',
  )
}

function succeeded(result: AutoRouterProcessResult): boolean {
  return result.error === undefined && result.status === 0 && result.signal === null
}

function readVersion(output: string, pattern: RegExp): readonly number[] | undefined {
  const match = pattern.exec(output)
  if (match === null) return undefined
  const version = [Number(match[1]), Number(match[2]), Number(match[3])]
  return version.every(Number.isSafeInteger) ? version : undefined
}

function compareVersion(actual: readonly number[], minimum: readonly number[]): number {
  const width = Math.max(actual.length, minimum.length)
  for (let index = 0; index < width; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function assertNever(value: never): never {
  throw new AutoRouterError(
    AutoRouterErrorCode.InvariantViolation,
    `Unsupported Auto Router validation variant: ${String(value)}`,
  )
}
