import { AgentCommand, AgentLaunchError } from './agent-launch-contracts'
import type {
  AgentLaunchBoundary,
  AgentLaunchInput,
  AgentProcessResult,
} from './agent-launch-contracts'
import { buildChildEnvironment } from './agent-launch-environment'
import {
  defaultBoundary,
  isExecutableNotFound,
  resolveExecutable,
} from './agent-launch-process'
import { normalizeOrigin } from './install-intent'

export {
  AgentCommand,
  AgentLaunchError,
} from './agent-launch-contracts'
export type {
  AgentCodexMode,
  AgentLaunchBoundary,
  AgentLaunchInput,
  AgentProcessResult,
  AgentSpawnOptions,
} from './agent-launch-contracts'

export function launchAgent(
  input: AgentLaunchInput,
  boundary: AgentLaunchBoundary = defaultBoundary(),
): AgentProcessResult {
  const command = parseAgentCommand(input.command)
  if (command === undefined) {
    throw new AgentLaunchError(`Unsupported agent command '${input.command}'.`)
  }

  const origin = normalizeGatewayOrigin(input.gatewayOrigin)
  const executable = resolveExecutable(command, boundary)
  const childEnvironment = buildChildEnvironment(command, input, origin)
  const args = buildAgentArguments(input.args)

  try {
    return boundary.spawn(executable, args, {
      stdio: 'inherit',
      env: childEnvironment,
    })
  } catch (error) {
    if (isExecutableNotFound(error)) {
      throw new AgentLaunchError(
        `The '${command}' executable was not found on PATH.`,
      )
    }
    throw error
  }
}

function parseAgentCommand(value: string): AgentCommand | undefined {
  switch (value) {
    case AgentCommand.Claude:
    case AgentCommand.Codex:
    case AgentCommand.OpenCode:
      return value
    default:
      return undefined
  }
}

function normalizeGatewayOrigin(value: string): string {
  const origin = normalizeOrigin(value)
  if (origin !== undefined) return origin
  throw new AgentLaunchError(
    'The LiteLLM gateway origin must be an absolute http(s) origin without credentials, query, or fragment.',
  )
}

function buildAgentArguments(
  args: readonly string[],
): readonly string[] {
  return [...args]
}
