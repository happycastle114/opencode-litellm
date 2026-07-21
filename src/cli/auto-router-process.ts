import { spawnSync } from 'node:child_process'
import {
  AUTO_ROUTER_ENVIRONMENT,
  AutoRouterMode,
  AutoRouterOperation,
  AutoRouterStdio,
  type AutoRouterPlan,
  type AutoRouterPlannedCommand,
} from './auto-router-contracts'
import {
  AutoRouterError,
  AutoRouterErrorCode,
  autoRouterInvariantViolation,
  validateAutoRouterPreflight,
  type AutoRouterProcessResult,
} from './auto-router-validation'

export {
  AutoRouterError,
  AutoRouterErrorCode,
  type AutoRouterProcessResult,
} from './auto-router-validation'

export type AutoRouterExecution = {
  readonly baseUrl: string
  readonly apiKey: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

export type AutoRouterProcessInvocation = AutoRouterPlannedCommand & {
  readonly environment: Readonly<Record<string, string | undefined>>
}

export type AutoRouterBoundary = {
  readonly isTTY: boolean
  readonly run: (invocation: AutoRouterProcessInvocation) => AutoRouterProcessResult
}

export type NodeAutoRouterBoundaryOptions = { readonly isTTY?: boolean }

type AutoRouterRunRequest = {
  readonly command: AutoRouterPlannedCommand
  readonly plan: AutoRouterPlan
  readonly execution: AutoRouterExecution
  readonly boundary: AutoRouterBoundary
}

export function createNodeAutoRouterBoundary(
  options: NodeAutoRouterBoundaryOptions = {},
): AutoRouterBoundary {
  return {
    isTTY: options.isTTY ?? (
      process.stdin.isTTY === true && process.stdout.isTTY === true
    ),
    run: (invocation) => {
      const result = spawnSync(invocation.executable, [...invocation.args], {
        encoding: 'utf8',
        env: { ...invocation.environment },
        stdio: invocation.stdio === AutoRouterStdio.Inherit
          ? 'inherit'
          : ['ignore', 'pipe', 'pipe'],
      })
      return {
        status: result.status,
        signal: result.signal,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
  }
}

export function preflightAutoRouter(
  plan: AutoRouterPlan,
  execution: AutoRouterExecution,
  boundary: AutoRouterBoundary = createNodeAutoRouterBoundary(),
): void {
  switch (plan.mode) {
    case AutoRouterMode.Skip:
    case AutoRouterMode.DryRun:
      return
    case AutoRouterMode.Configure:
      if (!boundary.isTTY) {
        throw new AutoRouterError(
          AutoRouterErrorCode.TtyRequired,
          'LiteLLM Auto Router configuration requires an interactive TTY; use --auto-router dry-run to inspect the plan.',
        )
      }
      for (const command of plan.commands.slice(0, -1)) {
        validateAutoRouterPreflight(command, run({ command, plan, execution, boundary }))
      }
      return
    default:
      return assertNever(plan.mode)
  }
}

export function applyAutoRouter(
  plan: AutoRouterPlan,
  execution: AutoRouterExecution,
  boundary: AutoRouterBoundary = createNodeAutoRouterBoundary(),
): void {
  switch (plan.mode) {
    case AutoRouterMode.Skip:
    case AutoRouterMode.DryRun:
      return
    case AutoRouterMode.Configure: {
      const command = plan.commands.at(-1)
      if (command === undefined || command.operation !== AutoRouterOperation.Configure) {
        throw autoRouterInvariantViolation()
      }
      const result = run({ command, plan, execution, boundary })
      if (!succeeded(result)) {
        throw new AutoRouterError(
          AutoRouterErrorCode.ConfigureFailed,
          'the official LiteLLM Auto Router wizard did not complete.',
        )
      }
      return
    }
    default:
      return assertNever(plan.mode)
  }
}

function run(request: AutoRouterRunRequest): AutoRouterProcessResult {
  const { command, plan, execution, boundary } = request
  try {
    return boundary.run({
      ...command,
      environment: {
        ...execution.environment,
        [AUTO_ROUTER_ENVIRONMENT.Home]: plan.homeDirectory,
        [AUTO_ROUTER_ENVIRONMENT.ProxyUrl]: execution.baseUrl,
        [AUTO_ROUTER_ENVIRONMENT.ProxyApiKey]: execution.apiKey,
      },
    })
  } catch {
    return { status: null, signal: null, stdout: '', stderr: '', error: true }
  }
}

function succeeded(result: AutoRouterProcessResult): boolean {
  return result.error === undefined && result.status === 0 && result.signal === null
}

function assertNever(value: never): never {
  throw new AutoRouterError(
    AutoRouterErrorCode.InvariantViolation,
    `Unsupported Auto Router variant: ${String(value)}`,
  )
}
