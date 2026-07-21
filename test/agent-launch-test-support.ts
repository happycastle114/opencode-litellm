import type {
  AgentLaunchBoundary,
  AgentProcessResult,
  AgentSpawnOptions,
} from '../src/cli/agent-launch'

export type CapturedAgentCall = {
  readonly file: string
  readonly args: readonly string[]
  readonly options: AgentSpawnOptions
}

export function boundaryFor(
  calls: CapturedAgentCall[],
  result: AgentProcessResult = { status: 0, signal: null },
): AgentLaunchBoundary {
  return {
    which: (command) => command,
    spawn: (file, args, options) => {
      calls.push({ file, args, options })
      return result
    },
  }
}
