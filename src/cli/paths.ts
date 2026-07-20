import { existsSync } from 'node:fs'
import { join } from 'node:path'

const OpenCodeConfigFile = {
  Jsonc: 'opencode.jsonc',
  Json: 'opencode.json',
} as const

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
  if (override !== undefined) return override

  const configHome = env.XDG_CONFIG_HOME ?? deriveConfigHome(env.HOME)
  const configDirectory = join(configHome, 'opencode')
  const jsoncPath = join(configDirectory, OpenCodeConfigFile.Jsonc)
  if (existsSync(jsoncPath)) return jsoncPath

  const jsonPath = join(configDirectory, OpenCodeConfigFile.Json)
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

export function resolveCodexConfigPath(override: string | undefined, env: PathEnv): string {
  if (override !== undefined) return override
  const home = env.HOME
  if (home === undefined || home === '') {
    throw new PathResolutionError('Unable to resolve the Codex config path: set HOME or pass --codex-config.')
  }
  return join(home, '.codex', 'config.toml')
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
