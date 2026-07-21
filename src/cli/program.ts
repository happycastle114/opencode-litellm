import {
  BOUNDARY_COMMAND,
  CLIENT_COMMAND,
  CORE_COMMAND,
  INVOCATION_KIND,
  parseCliArgs,
  runCli,
  type CliResult,
} from './command'
import type { DoctorOptions } from './argument-parser'
import type { InstallOptions } from './install-intent'
import { runAuthLifecycleCommand } from './program-auth-lifecycle'
import type { ProgramContext } from './program-contracts'
import { runAgent } from './program-agent'
import { runDoctor } from './program-doctor'
import { runInstall } from './program-install'

export type { ProgramContext } from './program-contracts'

export async function runCliProgram(
  argv: readonly string[],
  context: ProgramContext,
): Promise<CliResult> {
  const invocation = parseCliArgs(argv, context.env)
  if (invocation.kind !== INVOCATION_KIND.Command || invocation.help) return runCli(argv)

  try {
    switch (invocation.command) {
      case CLIENT_COMMAND.Install:
        return isInstallOptions(invocation.options)
          ? await runInstall(invocation.options, context)
          : failure('Install options could not be resolved.')
      case CORE_COMMAND.Doctor:
        return isDoctorOptions(invocation.options)
          ? runDoctor(invocation.options, context.env)
          : failure('Doctor options could not be resolved.')
      case BOUNDARY_COMMAND.Login:
      case BOUNDARY_COMMAND.Logout:
      case BOUNDARY_COMMAND.WhoAmI:
        return await runAuthLifecycleCommand(
          invocation.command,
          invocation.passthroughArgs ?? [],
          context,
        )
      case BOUNDARY_COMMAND.Claude:
      case BOUNDARY_COMMAND.Codex:
      case BOUNDARY_COMMAND.OpenCode:
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

function isInstallOptions(
  value: InstallOptions | DoctorOptions | undefined,
): value is InstallOptions {
  return value !== undefined && 'nonInteractive' in value
}

function isDoctorOptions(
  value: InstallOptions | DoctorOptions | undefined,
): value is DoctorOptions {
  return value !== undefined && 'json' in value
}

function failure(message: string): CliResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
