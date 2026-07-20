import { join } from 'node:path'
import {
  AgentCommand,
  launchAgent,
  type AgentLaunchBoundary,
} from './agent-launch'
import { parseCliArgs, runCli, type CliResult } from './command'
import type { DoctorOptions } from './argument-parser'
import {
  inspectCodexConfig,
  inspectOpenCodeConfig,
  type DoctorReport,
} from './doctor'
import {
  installPreparedClients,
  type ClientInstallerBoundary,
} from './client-installer'
import {
  prepareInstall,
  type InstallPreparationBoundary,
} from './install-preparation'
import {
  InstallTarget,
  ToolkitDefault,
  normalizeOrigin,
  type InstallOptions,
} from './install-intent'
import { loadOfficialLiteLLMApiKey } from './official-token'
import {
  runAuthLifecycleCommand,
  type ProgramAuthContext,
} from './program-auth-lifecycle'
import {
  PathResolutionError,
  resolveCodexConfigPath,
  resolveOpenCodeConfigPath,
  type PathEnv,
} from './paths'

const TOKEN_PATH = ['.litellm', 'token.json'] as const

export type ProgramContext = ClientInstallerBoundary & ProgramAuthContext & {
  readonly env: PathEnv & Readonly<Record<string, string | undefined>>
  readonly now: () => Date
  readonly onboardingIO?: InstallPreparationBoundary['onboardingIO']
  readonly gatewayDiscovery?: InstallPreparationBoundary['discover']
  readonly agentLaunchBoundary?: AgentLaunchBoundary
}

export async function runCliProgram(
  argv: readonly string[],
  context: ProgramContext,
): Promise<CliResult> {
  const invocation = parseCliArgs(argv)
  if (invocation.kind !== 'command' || invocation.help) return runCli(argv)

  try {
    switch (invocation.command) {
      case 'install':
        return isInstallOptions(invocation.options)
          ? await runInstall(invocation.options, context)
          : failure('Install options could not be resolved.')
      case 'doctor':
        return isDoctorOptions(invocation.options)
          ? runDoctor(invocation.options, context.env)
          : failure('Doctor options could not be resolved.')
      case 'login':
      case 'logout':
      case 'whoami':
        return await runAuthLifecycleCommand(
          invocation.command,
          invocation.passthroughArgs ?? [],
          context,
        )
      case 'claude':
      case 'codex':
      case 'opencode':
        return runAgent(
          invocation.command,
          invocation.passthroughArgs ?? [],
          context,
        )
      default:
        return assertNever(invocation.command)
    }
  } catch (error) {
    return error instanceof Error ? failure(error.message) : failure(String(error))
  }
}

async function runInstall(
  options: InstallOptions,
  context: ProgramContext,
): Promise<CliResult> {
  const prepared = await prepareInstall(options, {
    env: context.env,
    home: () => resolveHome(context.env),
    now: () => context.now().getTime(),
    ...(context.onboardingIO === undefined ? {} : { onboardingIO: context.onboardingIO }),
    ...(context.ssoBoundaries === undefined ? {} : { ssoBoundaries: context.ssoBoundaries }),
    ...(context.gatewayDiscovery === undefined ? {} : { discover: context.gatewayDiscovery }),
    ...(context.ssoOnboarding === undefined ? {} : { onboard: context.ssoOnboarding }),
  })
  const result = await installPreparedClients(prepared, context)
  const lines = [
    ...result.configured.map((entry) => `Configured ${entry.client}: ${entry.path}`),
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ]
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
}

function runAgent(
  command: 'claude' | 'codex' | 'opencode',
  argv: readonly string[],
  context: ProgramContext,
): CliResult {
  const origin = normalizeOrigin(
    context.env.LITELLM_PROXY_URL ?? ToolkitDefault.GatewayOrigin,
  )
  if (origin === undefined) return failure('LITELLM_PROXY_URL is not a valid gateway origin.')
  const apiKey = loadOfficialLiteLLMApiKey({
    tokenFilePath: resolveTokenPath(context.env),
    expectedBaseURL: origin,
  })
  if (apiKey === undefined) {
    return failure(`No exact-origin LiteLLM SSO token is available; run 'opencode-litellm login --base-url ${origin}'.`)
  }
  const result = launchAgent({
    command: agentCommand(command),
    args: argv,
    gatewayOrigin: origin,
    apiKey,
    environment: context.env,
  }, context.agentLaunchBoundary)
  return {
    exitCode: result.status ?? (result.signal === null ? 1 : 128),
    stdout: '',
    stderr: '',
  }
}

function runDoctor(options: DoctorOptions, env: PathEnv): CliResult {
  const reports: DoctorReport[] = []
  if (options.target === InstallTarget.OpenCode || options.target === InstallTarget.Both) {
    reports.push(inspectOpenCodeConfig(resolveOpenCodeConfigPath(options.opencodeConfig, env)))
  }
  if (options.target === InstallTarget.Codex || options.target === InstallTarget.Both) {
    reports.push(inspectCodexConfig(resolveCodexConfigPath(options.codexConfig, env)))
  }
  const status = reports.some((report) => report.status === 'error')
    ? 'error'
    : reports.some((report) => report.status === 'warn') ? 'warn' : 'ok'
  const report = { status, checks: reports.flatMap((entry) => entry.checks) }
  const stdout = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${report.checks.map((check) => `[${check.status}] ${check.message} (${check.path})`).join('\n')}\n`
  return { exitCode: status === 'error' ? 1 : 0, stdout, stderr: '' }
}

function resolveTokenPath(env: PathEnv): string {
  return join(resolveHome(env), ...TOKEN_PATH)
}

function resolveHome(env: PathEnv): string {
  if (env.HOME !== undefined && env.HOME !== '') return env.HOME
  throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
}

function agentCommand(command: 'claude' | 'codex' | 'opencode'): AgentCommand {
  switch (command) {
    case 'claude': return AgentCommand.Claude
    case 'codex': return AgentCommand.Codex
    case 'opencode': return AgentCommand.OpenCode
    default: return assertNever(command)
  }
}

function isInstallOptions(value: InstallOptions | DoctorOptions | undefined): value is InstallOptions {
  return value !== undefined && 'nonInteractive' in value
}

function isDoctorOptions(value: InstallOptions | DoctorOptions | undefined): value is DoctorOptions {
  return value !== undefined && 'json' in value
}

function failure(message: string): CliResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
