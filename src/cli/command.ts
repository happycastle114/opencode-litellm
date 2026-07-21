import { basename } from 'node:path'
import {
  parseDoctorOptions,
  parseInstallOptions,
  type CliEnvironment,
  type DoctorOptions,
} from './argument-parser'
import { InstallTarget, type InstallOptions } from './install-intent'

const CLIENT_BINARY = {
  OpenCode: 'opencode-litellm',
  Codex: 'codex-litellm',
} as const

const CLIENT_COMMAND = {
  Install: 'install',
} as const

const INVOCATION_KIND = {
  Command: 'command',
} as const

const BOUNDARY_COMMAND = {
  Login: 'login',
  Logout: 'logout',
  WhoAmI: 'whoami',
  Claude: 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
} as const

const GLOBAL_HELP = `Usage: opencode-litellm <command> [options]

Commands:
  install  Configure supported clients for LiteLLM
  doctor   Check the local LiteLLM integration
  login    Sign in with the built-in LiteLLM SSO onboarding flow
  logout   Remove the local LiteLLM SSO session
  whoami   Show safe local LiteLLM SSO session metadata
  claude   Launch Claude Code with OAuth-safe LiteLLM routing
  codex    Launch Codex with the installed LiteLLM profile
  opencode Launch OpenCode with the installed LiteLLM toolkit

Options:
  --target <opencode|codex|both>  Client target
  --base-url <url>                LiteLLM gateway origin
  --auth <sso|env>                Gateway authentication
  --auth-env <name>               Gateway key environment variable
  --codex-mode <gateway|oauth|both> Codex connection mode
  --search <name>                 Select an authorized search tool (repeatable)
  --mcp <name>                    Select an authorized MCP server (repeatable)
  --toolset <name>                Select an authorized MCP toolset (repeatable)
  --no-search                     Disable search tool registration
  --no-mcp                        Disable MCP server registration
  --no-toolsets                   Disable MCP toolset registration
  --non-interactive               Accept explicit values and discovery defaults
  -h, --help                      Show help
`

const INSTALL_HELP = `Usage: opencode-litellm install [options]

Configure supported clients for LiteLLM.

Options:
  -h, --help  Show help
`

const DOCTOR_HELP = `Usage: opencode-litellm doctor [options]

Check the local LiteLLM integration.

Options:
  -h, --help  Show help
`

const AUTH_HELP = `Usage: opencode-litellm <login|logout|whoami> [options]

Manage the built-in LiteLLM CLI-compatible SSO session.

Options:
  --base-url <url>  LiteLLM gateway origin
  --auth-env <name> Codex OAuth admission-key environment name
  -h, --help        Show help
`

const AGENT_HELP = `Usage: opencode-litellm <claude|codex|opencode> [args...]

Launch an agent with the installed LiteLLM toolkit while keeping credentials in memory.

Options:
  -h, --help  Show help; other arguments are forwarded to the agent
`

export type CliCommand =
  | 'install'
  | 'doctor'
  | (typeof BOUNDARY_COMMAND)[keyof typeof BOUNDARY_COMMAND]

type HelpInvocation = {
  readonly kind: 'help'
}

type CommandInvocation = {
  readonly kind: 'command'
  readonly command: CliCommand
  readonly help: boolean
  readonly options?: InstallOptions | DoctorOptions
  readonly passthroughArgs?: readonly string[]
}

type ParseError = {
  readonly kind: 'error'
  readonly message: string
}

export type ParsedInvocation = HelpInvocation | CommandInvocation | ParseError

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export function parseCliArgs(
  argv: readonly string[],
  environment: CliEnvironment = process.env,
): ParsedInvocation {
  const first = argv[0]

  if (first === undefined) return { kind: 'help' }
  if (first === '--help' || first === '-h') return parseGlobalHelp(argv)

  switch (first) {
    case 'install':
    case 'doctor':
    case 'login':
    case 'logout':
    case 'whoami':
    case 'claude':
    case 'codex':
    case 'opencode':
      return parseCommandArgs(first, argv.slice(1), environment)
    default:
      return first.startsWith('-')
        ? { kind: 'error', message: `Unknown option '${first}'.` }
        : { kind: 'error', message: `Unknown command '${first}'.` }
  }
}

export function applyBinaryDefaults(
  argv: readonly string[],
  executablePath: string,
): readonly string[] {
  if (argv[0] !== 'install' || argv.includes('--target')) return argv
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
    case 'help':
      return { exitCode: 0, stdout: GLOBAL_HELP, stderr: '' }
    case 'error':
      return {
        exitCode: 2,
        stdout: '',
        stderr: `${invocation.message}\nRun 'opencode-litellm --help' for usage.\n`,
      }
    case 'command':
      return runCommand(invocation)
    default:
      return assertNever(invocation)
  }
}

function parseGlobalHelp(argv: readonly string[]): ParsedInvocation {
  const extra = argv[1]
  return extra === undefined
    ? { kind: 'help' }
    : { kind: 'error', message: `Unexpected argument '${extra}' for global help.` }
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
      ? { kind: 'command', command, help: true, options: undefined }
      : { kind: 'error', message: `Unexpected argument '${extra}' for command '${command}'.` }
  }
  if (first !== undefined && !first.startsWith('-') && !isBoundaryCommand(command)) {
    return { kind: 'error', message: `Unexpected argument '${first}' for command '${command}'.` }
  }

  if (command === 'install') {
    const parsed = parseInstallOptions(argv, environment)
    return parsed.ok
      ? { kind: 'command', command, help: false, options: parsed.options }
      : { kind: 'error', message: parsed.message }
  }
  if (command === 'doctor') {
    const parsed = parseDoctorOptions(argv)
    return parsed.ok
      ? { kind: 'command', command, help: false, options: parsed.options }
      : { kind: 'error', message: parsed.message }
  }
  if (isBoundaryCommand(command)) {
    return { kind: 'command', command, help: false, passthroughArgs: argv }
  }

  if (first === undefined) return { kind: 'command', command, help: false }

  if (!first.startsWith('-')) {
    return { kind: 'error', message: `Unexpected argument '${first}' for command '${command}'.` }
  }
  return { kind: 'error', message: `Unknown option '${first}' for command '${command}'.` }
}

function runCommand(invocation: CommandInvocation): CliResult {
  if (invocation.help) return { exitCode: 0, stdout: helpForCommand(invocation.command), stderr: '' }

  switch (invocation.command) {
    case 'install':
    case 'doctor':
      return {
        exitCode: 1,
        stdout: '',
        stderr: `The '${invocation.command}' command is not implemented yet.\n`,
      }
    case 'login':
    case 'logout':
    case 'whoami':
    case 'claude':
    case 'codex':
    case 'opencode':
      return {
        exitCode: 1,
        stdout: '',
        stderr: `The '${invocation.command}' command requires the program process boundary.\n`,
      }
    default:
      return assertNever(invocation.command)
  }
}

function helpForCommand(command: CliCommand): string {
  switch (command) {
    case 'install':
      return INSTALL_HELP
    case 'doctor':
      return DOCTOR_HELP
    case 'login':
    case 'logout':
    case 'whoami':
      return AUTH_HELP
    case 'claude':
    case 'codex':
    case 'opencode':
      return AGENT_HELP
    default:
      return assertNever(command)
  }
}

function isBoundaryCommand(command: CliCommand): command is (typeof BOUNDARY_COMMAND)[keyof typeof BOUNDARY_COMMAND] {
  return Object.values(BOUNDARY_COMMAND).some((candidate) => candidate === command)
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
