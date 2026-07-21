import type { DoctorOptions } from './argument-parser'
import type { InstallOptions } from './install-intent'

export const CLIENT_BINARY = {
  OpenCode: 'opencode-litellm',
  Codex: 'codex-litellm',
} as const

export const CLIENT_COMMAND = {
  Install: 'install',
} as const

export const CORE_COMMAND = {
  Doctor: 'doctor',
} as const

export const INVOCATION_KIND = {
  Help: 'help',
  Command: 'command',
  Error: 'error',
} as const

export const BOUNDARY_COMMAND = {
  Login: 'login',
  Logout: 'logout',
  WhoAmI: 'whoami',
  Claude: 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
} as const

export type CliCommand =
  | (typeof CLIENT_COMMAND)[keyof typeof CLIENT_COMMAND]
  | (typeof CORE_COMMAND)[keyof typeof CORE_COMMAND]
  | (typeof BOUNDARY_COMMAND)[keyof typeof BOUNDARY_COMMAND]

export type HelpInvocation = {
  readonly kind: typeof INVOCATION_KIND.Help
}

export type CommandInvocation = {
  readonly kind: typeof INVOCATION_KIND.Command
  readonly command: CliCommand
  readonly help: boolean
  readonly options?: InstallOptions | DoctorOptions
  readonly passthroughArgs?: readonly string[]
}

export type ParseError = {
  readonly kind: typeof INVOCATION_KIND.Error
  readonly message: string
}

export type ParsedInvocation = HelpInvocation | CommandInvocation | ParseError

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export function isBoundaryCommand(
  command: CliCommand,
): command is (typeof BOUNDARY_COMMAND)[keyof typeof BOUNDARY_COMMAND] {
  return Object.values(BOUNDARY_COMMAND).some((candidate) => candidate === command)
}
