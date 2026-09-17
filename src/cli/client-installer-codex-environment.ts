import { spawnSync } from 'node:child_process'
import type { CodexSpawnBoundary, CodexSpawnResult } from './codex-discovery'
import type { PathEnv } from './paths'

const LAUNCHCTL = {
  Path: '/bin/launchctl',
  UnsetEnvironment: 'unsetenv',
} as const
const PLATFORM = { Darwin: 'darwin' } as const

export type CodexEnvironmentBoundary = {
  readonly env: PathEnv & Readonly<Record<string, string | undefined>>
  readonly externalSetup?: boolean
  readonly codexSpawnBoundary?: CodexSpawnBoundary
  readonly platform?: string
}

export function clearCodexSessionEnvironment(
  authEnv: string,
  boundary: CodexEnvironmentBoundary,
): readonly string[] {
  if (!usesMacOSSession(boundary)) return []
  const result = runCodexSpawn(boundary, LAUNCHCTL.Path, [
    LAUNCHCTL.UnsetEnvironment,
    authEnv,
  ])
  return processSucceeded(result)
    ? []
    : [`The local SSO token was removed, but ${authEnv} could not be cleared from the current macOS launchd session; run '${LAUNCHCTL.Path} ${LAUNCHCTL.UnsetEnvironment} ${authEnv}'.`]
}

function runCodexSpawn(
  boundary: CodexEnvironmentBoundary,
  file: string,
  args: readonly string[],
): CodexSpawnResult {
  const options = { stdio: 'ignore', env: { ...process.env, ...boundary.env } } as const
  if (boundary.codexSpawnBoundary !== undefined) {
    return boundary.codexSpawnBoundary.spawn(file, args, options)
  }
  const result = spawnSync(file, [...args], options)
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

function usesMacOSSession(boundary: CodexEnvironmentBoundary): boolean {
  return boundary.externalSetup === true &&
    (boundary.platform ?? process.platform) === PLATFORM.Darwin
}

function processSucceeded(result: CodexSpawnResult): boolean {
  const status = result.status ?? result.exitCode
  return status === 0 &&
    (result.signal === undefined || result.signal === null) &&
    result.error === undefined
}
