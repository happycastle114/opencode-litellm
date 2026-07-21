import { CodexMode } from './install-intent'

export const AgentCommand = {
  Claude: 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
} as const

export type AgentCommand = (typeof AgentCommand)[keyof typeof AgentCommand]
export type AgentCodexMode = (typeof CodexMode)[keyof typeof CodexMode]

export type AgentLaunchInput = {
  readonly command: AgentCommand | string
  readonly args: readonly string[]
  readonly gatewayOrigin: string
  readonly apiKey?: string
  readonly authEnv?: string
  readonly configPath?: string
  readonly codexMode?: AgentCodexMode
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export type AgentProcessResult = {
  readonly status: number | null
  readonly signal: string | null
}

export type AgentSpawnOptions = {
  readonly stdio: 'inherit'
  readonly env: Readonly<Record<string, string | undefined>>
}

export type AgentLaunchBoundary = {
  readonly which?: (command: AgentCommand) => string | undefined
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: AgentSpawnOptions,
  ) => AgentProcessResult
}

export class AgentLaunchError extends Error {
  readonly name = 'AgentLaunchError'
}
