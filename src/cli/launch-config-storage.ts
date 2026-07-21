import { join } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  type ClientInstallExpectation,
  type ClientInstallWriteAssetPlan,
} from './client-install-assets'
import { CONFIG_FILE_MODE, writeConfigAtomic } from './file-adapter'
import {
  LaunchConfigError,
  MULTIPLE_SSO_ORIGINS_ERROR,
  parseLaunchConfig,
  validateLaunchConfig,
  type LaunchConfig,
  type LaunchConfigEnvironment,
} from './launch-config-schema'
import {
  assertManagedRegularFileOrAbsent,
  managedPathEntryExists,
  readManagedFileSnapshot,
} from './managed-file-safety'

const LAUNCH_CONFIG_DIRECTORY = 'opencode-litellm'
const LAUNCH_CONFIG_FILE = 'launch.json'

export type LaunchConfigWriteOptions = {
  readonly env: LaunchConfigEnvironment
  readonly now: () => Date
  readonly path?: string
}

export type LaunchConfigReadOptions = {
  readonly env: LaunchConfigEnvironment
  readonly path?: string
}

export type LaunchConfigPlanOptions = {
  readonly env: LaunchConfigEnvironment
  readonly path?: string
  readonly expectation?: ClientInstallExpectation
}

export type LaunchConfigSnapshot = {
  readonly config: LaunchConfig | undefined
  readonly expectation: ClientInstallExpectation
}

export function resolveLaunchConfigPath(env: LaunchConfigEnvironment): string {
  const configHome = nonEmpty(env.XDG_CONFIG_HOME) ?? homeConfigHome(env.HOME)
  return join(configHome, LAUNCH_CONFIG_DIRECTORY, LAUNCH_CONFIG_FILE)
}

export function persistLaunchConfig(
  config: LaunchConfig,
  options: LaunchConfigWriteOptions,
): string {
  const asset = planLaunchConfigAsset(config, options)
  assertLaunchConfigPathWritable(asset.path)
  writeConfigAtomic(asset.path, asset.contents, { now: options.now })
  return asset.path
}

export const saveLaunchConfig = persistLaunchConfig

export function planLaunchConfigAsset(
  config: LaunchConfig,
  options: LaunchConfigPlanOptions,
): ClientInstallWriteAssetPlan {
  validateLaunchConfig(config)
  const path = options.path ?? resolveLaunchConfigPath(options.env)
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path,
    contents: `${JSON.stringify(config, null, 2)}\n`,
    mode: CONFIG_FILE_MODE,
    expectation: options.expectation ?? { previous: readManagedFileSnapshot(path) },
  }
}

export function assertLaunchConfigPathWritable(path: string): void {
  try {
    assertManagedRegularFileOrAbsent(path)
  } catch {
    throw unwritableLaunchConfig(path)
  }
}

export function loadLaunchConfig(options: LaunchConfigReadOptions): LaunchConfig {
  const path = options.path ?? resolveLaunchConfigPath(options.env)
  if (!managedPathEntryExists(path)) throw missingLaunchConfig(path)
  return readLaunchConfig(path)
}

export function loadLaunchConfigIfPresent(
  options: LaunchConfigReadOptions,
): LaunchConfig | undefined {
  const path = options.path ?? resolveLaunchConfigPath(options.env)
  return managedPathEntryExists(path) ? readLaunchConfig(path) : undefined
}

export function loadLaunchConfigSnapshot(
  options: LaunchConfigReadOptions,
): LaunchConfigSnapshot {
  const path = options.path ?? resolveLaunchConfigPath(options.env)
  const previous = readManagedFileSnapshot(path)
  return {
    config: previous === undefined
      ? undefined
      : parseLaunchConfigSource(previous.contents.toString('utf8'), path),
    expectation: { previous },
  }
}

function readLaunchConfig(path: string): LaunchConfig {
  let source: string
  try {
    const snapshot = readManagedFileSnapshot(path)
    if (snapshot === undefined) throw unreadableLaunchConfig(path)
    source = snapshot.contents.toString('utf8')
  } catch {
    throw unreadableLaunchConfig(path)
  }

  return parseLaunchConfigSource(source, path)
}

function parseLaunchConfigSource(source: string, path: string): LaunchConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw malformedLaunchConfig(path)
  }

  try {
    return parseLaunchConfig(parsed)
  } catch (error) {
    throw error instanceof Error && error.message === MULTIPLE_SSO_ORIGINS_ERROR
      ? malformedLaunchConfig(path, MULTIPLE_SSO_ORIGINS_ERROR)
      : malformedLaunchConfig(path)
  }
}

function homeConfigHome(home: string | undefined): string {
  const value = nonEmpty(home)
  if (value === undefined) {
    throw new LaunchConfigError(
      'Unable to resolve the LiteLLM launch configuration path: set HOME or XDG_CONFIG_HOME.',
    )
  }
  return join(value, '.config')
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

function missingLaunchConfig(path: string): LaunchConfigError {
  return new LaunchConfigError(
    `LiteLLM launch configuration is missing at ${path}; run 'opencode-litellm install' first.`,
  )
}

function unreadableLaunchConfig(path: string): LaunchConfigError {
  return new LaunchConfigError(
    `LiteLLM launch configuration at ${path} could not be read; run 'opencode-litellm install' again.`,
  )
}

function malformedLaunchConfig(path: string, detail?: string): LaunchConfigError {
  return new LaunchConfigError(
    `LiteLLM launch configuration at ${path} is malformed or from an older release${detail === undefined ? '' : ` (${detail})`}; remove this file, then run 'opencode-litellm install' again.`,
  )
}

function unwritableLaunchConfig(path: string): LaunchConfigError {
  return new LaunchConfigError(
    `LiteLLM launch configuration cannot be written at ${path}; set HOME or XDG_CONFIG_HOME to a writable directory, then run the install again.`,
  )
}
