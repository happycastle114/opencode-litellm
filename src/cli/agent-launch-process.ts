import { spawnSync } from 'node:child_process'
import {
  AgentLaunchError,
  type AgentCommand,
  type AgentLaunchBoundary,
} from './agent-launch-contracts'

export function resolveExecutable(
  command: AgentCommand,
  boundary: AgentLaunchBoundary,
): string {
  try {
    const executable = boundary.which === undefined
      ? command
      : boundary.which(command)
    if (executable !== undefined) return executable
  } catch (error) {
    if (!isExecutableNotFound(error)) throw error
  }
  throw new AgentLaunchError(`The '${command}' executable was not found on PATH.`)
}

export function isExecutableNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if ('code' in error && error.code === 'ENOENT') return true
  return error.message.includes('ENOENT') || error.message.includes('not found')
}

export function defaultBoundary(): AgentLaunchBoundary {
  return {
    spawn: (file, args, options) => {
      const result = spawnSync(file, [...args], {
        stdio: options.stdio,
        env: { ...options.env },
      })
      if (result.error !== undefined) throw result.error
      return { status: result.status, signal: result.signal }
    },
  }
}
