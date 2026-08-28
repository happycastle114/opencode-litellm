import { spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import {
  AgentLaunchError,
  type AgentCommand,
  type AgentLaunchBoundary,
} from './agent-launch-contracts'

const IS_WINDOWS = process.platform === 'win32'
const EXECUTABLE_EXTENSIONS = IS_WINDOWS ? ['.exe', '.cmd', '.bat', '.ps1'] : ['']

export function resolveExecutable(
  command: AgentCommand,
  boundary: AgentLaunchBoundary,
): string {
  if (boundary.which !== undefined) {
    try {
      const executable = boundary.which(command)
      if (executable !== undefined) return executable
    } catch (error) {
      if (!isExecutableNotFound(error)) throw error
    }
  } else {
    const found = findOnPath(command)
    if (found !== undefined) return found
  }
  throw new AgentLaunchError(
    `The '${command}' executable was not found on PATH.\n` +
    (IS_WINDOWS
      ? `  On Windows, make sure '${command}.exe' or '${command}.cmd' is in your PATH.\n` +
        `  Check with: where ${command}\n` +
        `  If installed via npm: npm config get prefix`
      : `  Check with: which ${command}`),
  )
}

function findOnPath(command: string): string | undefined {
  const pathEnv = process.env.PATH ?? ''
  if (pathEnv === '') return undefined
  for (const dir of pathEnv.split(IS_WINDOWS ? ';' : ':')) {
    if (dir === '') continue
    for (const ext of EXECUTABLE_EXTENSIONS) {
      const candidate = join(dir, `${command}${ext}`)
      try {
        accessSync(candidate, IS_WINDOWS ? fsConstants.F_OK : fsConstants.X_OK)
        return candidate
      } catch { /* not found, try next */ }
    }
  }
  return undefined
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
        shell: IS_WINDOWS,
      })
      if (result.error !== undefined) throw result.error
      return { status: result.status, signal: result.signal }
    },
  }
}
