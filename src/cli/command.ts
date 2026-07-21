import { basename } from 'node:path'
import {
  parseDoctorOptions,
  parseInstallOptions,
  type CliEnvironment,
} from './argument-parser'
import { InstallTarget } from './install-intent'
import {
  BOUNDARY_COMMAND,
  CLIENT_BINARY,
  CLIENT_COMMAND,
  CORE_COMMAND,
  INVOCATION_KIND,
  isBoundaryCommand,
  type CliCommand,
  type CommandInvocation,
  type ParsedInvocation,
  type CliResult,
} from './command-contracts'
import { GLOBAL_HELP, helpForCommand } from './command-help'

export type { CliCommand, ParsedInvocation, CliResult } from './command-contracts'
export {
  BOUNDARY_COMMAND,
  CLIENT_BINARY,
  CLIENT_COMMAND,
  CORE_COMMAND,
  INVOCATION_KIND,
} from './command-contracts'
export type {
  CommandInvocation,
  HelpInvocation,
  ParseError,
} from './command-contracts'

export function parseCliArgs(
  argv: readonly string[],
  environment: CliEnvironment = process.env,
): ParsedInvocation {
  const first = argv[0]

  if (first === undefined) return { kind: INVOCATION_KIND.Help }
  if (first === '--help' || first === '-h') return parseGlobalHelp(argv)

  switch (first) {
    case CLIENT_COMMAND.Install:
    case CORE_COMMAND.Doctor:
    case BOUNDARY_COMMAND.Login:
    case BOUNDARY_COMMAND.Logout:
    case BOUNDARY_COMMAND.WhoAmI:
    case BOUNDARY_COMMAND.Claude:
    case BOUNDARY_COMMAND.Codex:
    case BOUNDARY_COMMAND.OpenCode:
      return parseCommandArgs(first, argv.slice(1), environment)
    default:
      return first.startsWith('-')
        ? { kind: INVOCATION_KIND.Error, message: `Unknown option '${first}'.` }
        : { kind: INVOCATION_KIND.Error, message: `Unknown command '${first}'.` }
  }
}

export function applyBinaryDefaults(
  argv: readonly string[],
  executablePath: string,
): readonly string[] {
  if (argv[0] !== CLIENT_COMMAND.Install || argv.includes('--target')) return argv
  const target = basename(executablePath) === CLIENT_BINARY.Codex
    ? InstallTarget.Codex
    : InstallTarget.OpenCode
  return [argv[0], '--target', target, ...argv.slice(1)]
}

export function needsNodeOnboardingBoundary(argv: readonly string[]): boolean {
  const invocation = parseCliArgs(argv)
  if (invocation.kind !== INVOCATION_KIND.Command || invocation.help) return false
  if (invocation.command === BOUNDARY_COMMAND.Login) return true
  return invocation.command === CLIENT_COMMAND.Install &&
    invocation.options !== undefined &&
    'nonInteractive' in invocation.options &&
    !invocation.options.nonInteractive
}

export function runCli(argv: readonly string[]): CliResult {
  const invocation = parseCliArgs(argv)

  switch (invocation.kind) {
    case INVOCATION_KIND.Help:
      return { exitCode: 0, stdout: GLOBAL_HELP, stderr: '' }
    case INVOCATION_KIND.Error:
      return {
        exitCode: 2,
        stdout: '',
        stderr: `${invocation.message}\nRun 'opencode-litellm --help' for usage.\n`,
      }
    case INVOCATION_KIND.Command:
      return runCommand(invocation)
    default:
      return assertNever(invocation)
  }
}

function parseGlobalHelp(argv: readonly string[]): ParsedInvocation {
  const extra = argv[1]
  return extra === undefined
    ? { kind: INVOCATION_KIND.Help }
    : { kind: INVOCATION_KIND.Error, message: `Unexpected argument '${extra}' for global help.` }
}

function parseCommandArgs(
  command: CliCommand,
  argv: readonly string[],
  environment: CliEnvironment,
): ParsedInvocation {
  const first = argv[0]

  if (first === '--help' || first === '-h') {
    const extra = argv[1]
    return extra === undefined
      ? { kind: INVOCATION_KIND.Command, command, help: true, options: undefined }
      : { kind: INVOCATION_KIND.Error, message: `Unexpected argument '${extra}' for command '${command}'.` }
  }
  if (first !== undefined && !first.startsWith('-') && !isBoundaryCommand(command)) {
    return { kind: INVOCATION_KIND.Error, message: `Unexpected argument '${first}' for command '${command}'.` }
  }

  if (command === CLIENT_COMMAND.Install) {
    const parsed = parseInstallOptions(argv, environment)
    return parsed.ok
      ? { kind: INVOCATION_KIND.Command, command, help: false, options: parsed.options }
      : { kind: INVOCATION_KIND.Error, message: parsed.message }
  }
  if (command === CORE_COMMAND.Doctor) {
    const parsed = parseDoctorOptions(argv)
    return parsed.ok
      ? { kind: INVOCATION_KIND.Command, command, help: false, options: parsed.options }
      : { kind: INVOCATION_KIND.Error, message: parsed.message }
  }
  if (isBoundaryCommand(command)) {
    return { kind: INVOCATION_KIND.Command, command, help: false, passthroughArgs: argv }
  }

  if (first === undefined) return { kind: INVOCATION_KIND.Command, command, help: false }

  if (!first.startsWith('-')) {
    return { kind: INVOCATION_KIND.Error, message: `Unexpected argument '${first}' for command '${command}'.` }
  }
  return { kind: INVOCATION_KIND.Error, message: `Unknown option '${first}' for command '${command}'.` }
}

function runCommand(invocation: CommandInvocation): CliResult {
  if (invocation.help) return { exitCode: 0, stdout: helpForCommand(invocation.command), stderr: '' }

  switch (invocation.command) {
    case CLIENT_COMMAND.Install:
    case CORE_COMMAND.Doctor:
      return {
        exitCode: 1,
        stdout: '',
        stderr: `The '${invocation.command}' command is not implemented yet.\n`,
      }
    case BOUNDARY_COMMAND.Login:
    case BOUNDARY_COMMAND.Logout:
    case BOUNDARY_COMMAND.WhoAmI:
    case BOUNDARY_COMMAND.Claude:
    case BOUNDARY_COMMAND.Codex:
    case BOUNDARY_COMMAND.OpenCode:
      return {
        exitCode: 1,
        stdout: '',
        stderr: `The '${invocation.command}' command requires the program process boundary.\n`,
      }
    default:
      return assertNever(invocation.command)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
