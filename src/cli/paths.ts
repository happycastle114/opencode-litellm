import { basename, join, resolve } from 'node:path'
import { managedPathEntryExists } from './managed-file-safety'

const OpenCodeConfigFile = {
  Jsonc: 'opencode.jsonc',
  Json: 'opencode.json',
} as const
const CODEX_CONFIG_FILE = 'config.toml' as const

export type PathEnv = {
  readonly HOME?: string
  readonly XDG_CONFIG_HOME?: string
}

export class PathResolutionError extends Error {
  readonly name = 'PathResolutionError'
}

export function resolveOpenCodeConfigPath(
  override: string | undefined,
  env: PathEnv,
): string {
  const [jsoncPath, jsonPath] = resolveOpenCodeConfigCandidatePaths(override, env)
  if (jsonPath === undefined) return jsoncPath
  if (managedPathEntryExists(jsoncPath)) return jsoncPath
  return managedPathEntryExists(jsonPath) ? jsonPath : jsoncPath
}

export function resolveOpenCodeConfigCandidatePaths(
  override: string | undefined,
  env: PathEnv,
): readonly [string, string?] {
  if (override !== undefined) return [resolve(override)]
  const configHome = nonEmpty(env.XDG_CONFIG_HOME) ?? deriveConfigHome(env.HOME)
  const configDirectory = join(configHome, 'opencode')
  return [
    join(configDirectory, OpenCodeConfigFile.Jsonc),
    join(configDirectory, OpenCodeConfigFile.Json),
  ]
}

export function resolveCodexConfigPath(override: string | undefined, env: PathEnv): string {
  if (override !== undefined) {
    const resolved = resolve(override)
    if (basename(resolved) !== CODEX_CONFIG_FILE) {
      throw new PathResolutionError(
        `Codex config path must end in '${CODEX_CONFIG_FILE}'.`,
      )
    }
    return resolved
  }
  const home = env.HOME
  if (home === undefined || home === '') {
    throw new PathResolutionError('Unable to resolve the Codex config path: set HOME or pass --codex-config.')
  }
  return join(home, '.codex', CODEX_CONFIG_FILE)
}

export function resolveCodexCatalogPath(configPath: string): string {
  return join(configPath, '..', 'litellm-models.json')
}

function deriveConfigHome(home: string | undefined): string {
  if (home === undefined || home === '') {
    throw new PathResolutionError(
      'Unable to resolve the OpenCode config path: set HOME or XDG_CONFIG_HOME, or pass --opencode-config.',
    )
  }
  return join(home, '.config')
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}
