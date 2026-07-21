import { join } from 'node:path'

export const AutoRouterMode = {
  Prompt: 'prompt',
  Skip: 'skip',
  Configure: 'configure',
  DryRun: 'dry-run',
} as const
export type AutoRouterMode = (typeof AutoRouterMode)[keyof typeof AutoRouterMode]

export const AutoRouterOperation = {
  RuntimeVersion: 'runtime-version',
  RustCompilerVersion: 'rust-compiler-version',
  CargoVersion: 'cargo-version',
  CliVersion: 'cli-version',
  ConfigureHelp: 'configure-help',
  Configure: 'configure',
} as const
export type AutoRouterOperation =
  (typeof AutoRouterOperation)[keyof typeof AutoRouterOperation]

export const AutoRouterStdio = {
  Capture: 'capture',
  Inherit: 'inherit',
} as const
export type AutoRouterStdio =
  (typeof AutoRouterStdio)[keyof typeof AutoRouterStdio]

export const AUTO_ROUTER_PIN = {
  Requirement: 'litellm[proxy]==1.94.0rc1',
  CliVersion: '1.94.0rc1',
  MinimumUvVersion: '0.10.9',
  Revision: '5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5',
} as const

export const AUTO_ROUTER_ENVIRONMENT = {
  ProxyUrl: 'LITELLM_PROXY_URL',
  ProxyApiKey: 'LITELLM_PROXY_API_KEY',
  Home: 'HOME',
} as const

export const AutoRouterPlatform = {
  Darwin: 'darwin',
  Linux: 'linux',
  Windows: 'win32',
} as const

const EXECUTABLE = {
  Uv: 'uv',
  RustCompiler: 'rustc',
  Cargo: 'cargo',
  Lite: 'lite',
} as const
const COMMAND = {
  Tool: 'tool',
  Run: 'run',
  Isolated: '--isolated',
  From: '--from',
  Version: '--version',
  AutoRoute: 'autoroute',
  Configure: 'configure',
  Help: '--help',
  Up: 'up',
  Down: 'down',
} as const
const CONFIG_PATH = ['.litellm', 'autorouter', 'config.yaml'] as const
const SHELL_SAFE_ARGUMENT = /^[A-Za-z0-9_./:@%+=,-]+$/

const AUTO_ROUTER_LIFECYCLE_ARGS = [
  COMMAND.Tool,
  COMMAND.Run,
  COMMAND.Isolated,
  COMMAND.From,
  AUTO_ROUTER_PIN.Requirement,
  EXECUTABLE.Lite,
  COMMAND.AutoRoute,
] as const

export const AUTO_ROUTER_LIFECYCLE_COMMAND = {
  Up: formatShellCommand(EXECUTABLE.Uv, [...AUTO_ROUTER_LIFECYCLE_ARGS, COMMAND.Up]),
  Down: formatShellCommand(EXECUTABLE.Uv, [...AUTO_ROUTER_LIFECYCLE_ARGS, COMMAND.Down]),
} as const

export type AutoRouterPlannedCommand = {
  readonly operation: AutoRouterOperation
  readonly executable: string
  readonly args: readonly string[]
  readonly stdio: AutoRouterStdio
}

export type AutoRouterPlan = {
  readonly mode: Exclude<AutoRouterMode, typeof AutoRouterMode.Prompt>
  readonly homeDirectory: string
  readonly configPath: string
  readonly platform: string
  readonly commands: readonly AutoRouterPlannedCommand[]
}

type AutoRouterPlanInput = Omit<AutoRouterPlan, 'configPath'>

export function planAutoRouter(
  mode: AutoRouterMode,
  homeDirectory: string,
  platform: string = process.platform,
): AutoRouterPlan {
  switch (mode) {
    case AutoRouterMode.Skip:
      return buildPlan({ mode, homeDirectory, platform, commands: [] })
    case AutoRouterMode.Configure:
    case AutoRouterMode.DryRun:
      return buildPlan({
        mode,
        homeDirectory,
        platform,
        commands: autoRouterCommands(platform),
      })
    case AutoRouterMode.Prompt:
      throw new AutoRouterPlanError('Auto Router prompt mode must be resolved before planning.')
    default:
      return assertNever(mode)
  }
}

export function formatAutoRouterPlan(plan: AutoRouterPlan): string {
  const commandLines = plan.commands.map(
    (command, index) => `${index + 1}. ${formatShellCommand(command.executable, command.args)}`,
  )
  return [
    'Auto Router dry-run (Claude Code only; no commands executed):',
    ...commandLines,
    `Official config path: ${plan.configPath} (0600; provider API key is persisted by LiteLLM)`,
    `Credential transport: ${AUTO_ROUTER_ENVIRONMENT.ProxyApiKey} child environment (value hidden)`,
  ].join('\n')
}

export function formatShellCommand(
  executable: string,
  args: readonly string[],
): string {
  return [executable, ...args].map(quoteShellArgument).join(' ')
}

export class AutoRouterPlanError extends Error {
  readonly name = 'AutoRouterPlanError'
}

function buildPlan(input: AutoRouterPlanInput): AutoRouterPlan {
  return {
    ...input,
    configPath: join(input.homeDirectory, ...CONFIG_PATH),
  }
}

function autoRouterCommands(platform: string): readonly AutoRouterPlannedCommand[] {
  const litePrefix = [
    COMMAND.Tool,
    COMMAND.Run,
    COMMAND.Isolated,
    COMMAND.From,
    AUTO_ROUTER_PIN.Requirement,
    EXECUTABLE.Lite,
  ] as const
  return [
    {
      operation: AutoRouterOperation.RuntimeVersion,
      executable: EXECUTABLE.Uv,
      args: [COMMAND.Version],
      stdio: AutoRouterStdio.Capture,
    },
    ...(platform !== AutoRouterPlatform.Linux
      ? [
          {
            operation: AutoRouterOperation.RustCompilerVersion,
            executable: EXECUTABLE.RustCompiler,
            args: [COMMAND.Version],
            stdio: AutoRouterStdio.Capture,
          },
          {
            operation: AutoRouterOperation.CargoVersion,
            executable: EXECUTABLE.Cargo,
            args: [COMMAND.Version],
            stdio: AutoRouterStdio.Capture,
          },
        ]
      : []),
    {
      operation: AutoRouterOperation.CliVersion,
      executable: EXECUTABLE.Uv,
      args: [...litePrefix, COMMAND.Version],
      stdio: AutoRouterStdio.Capture,
    },
    {
      operation: AutoRouterOperation.ConfigureHelp,
      executable: EXECUTABLE.Uv,
      args: [...litePrefix, COMMAND.AutoRoute, COMMAND.Configure, COMMAND.Help],
      stdio: AutoRouterStdio.Capture,
    },
    {
      operation: AutoRouterOperation.Configure,
      executable: EXECUTABLE.Uv,
      args: [...litePrefix, COMMAND.AutoRoute, COMMAND.Configure],
      stdio: AutoRouterStdio.Inherit,
    },
  ]
}

function assertNever(value: never): never {
  throw new AutoRouterPlanError(`Unsupported Auto Router mode: ${String(value)}`)
}

function quoteShellArgument(argument: string): string {
  if (SHELL_SAFE_ARGUMENT.test(argument)) return argument
  const escaped = argument.replaceAll("'", "'\"'\"'")
  return `'${escaped}'`
}
