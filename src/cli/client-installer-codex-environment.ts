import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolveCodexAuthHelperPath } from './auth-helper'
import type { CodexSpawnBoundary, CodexSpawnResult } from './codex-discovery'
import type { PreparedInstall } from './install-preparation'
import { CodexMode, InstallAuth } from './install-intent'
import type { PathEnv } from './paths'

const HELPER_ARGUMENT = { LaunchctlSetEnvironment: '--launchctl-setenv' } as const
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

class CodexEnvironmentError extends Error {
  readonly name = 'CodexEnvironmentError'
}

export function syncCodexOAuthEnvironment(
  prepared: PreparedInstall,
  boundary: CodexEnvironmentBoundary,
  homeDirectory: string,
): readonly string[] {
  if (
    prepared.options.auth !== InstallAuth.Sso ||
    !usesOAuth(prepared.options.codexMode)
  ) return []
  return syncCodexSessionEnvironment(
    prepared.options.authEnv,
    boundary,
    homeDirectory,
  )
}

export function syncCodexSessionEnvironment(
  authEnv: string,
  boundary: CodexEnvironmentBoundary,
  homeDirectory: string,
): readonly string[] {
  if (!usesMacOSSession(boundary)) return []
  const helperPath = resolveCodexAuthHelperPath(homeDirectory)
  if (!existsSync(helperPath)) return []
  const warning = sessionExportWarning(authEnv)
  try {
    const result = runCodexSpawn(boundary, process.execPath, [
      helperPath,
      HELPER_ARGUMENT.LaunchctlSetEnvironment,
      authEnv,
    ])
    return processSucceeded(result) ? [] : [warning]
  } catch {
    return [warning]
  }
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

function usesOAuth(mode: PreparedInstall['options']['codexMode']): boolean {
  switch (mode) {
    case CodexMode.Gateway:
      return false
    case CodexMode.OAuth:
    case CodexMode.Both:
      return true
    default:
      return assertNever(mode)
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

function sessionExportWarning(authEnv: string): string {
  return `Could not export ${authEnv} to the current macOS launchd session; run 'codex-litellm codex --profile codex-oauth' or rerun the installer after login.`
}

function assertNever(value: never): never {
  throw new CodexEnvironmentError('Codex environment setup reached an unsupported typed variant.')
}
