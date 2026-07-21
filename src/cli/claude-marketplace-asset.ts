import { join } from 'node:path'
import {
  CLIENT_INSTALL_ASSET_OPERATION,
  type ClientInstallExpectation,
  type ClientInstallWriteAssetPlan,
} from './client-install-assets'
import { normalizeOrigin } from './install-intent'
import { readManagedFileSnapshot } from './managed-file-safety'

const CLAUDE_SETTINGS_FILE = 'settings.json' as const
const CLAUDE_SETTINGS_DIRECTORY = '.claude' as const
const CLAUDE_MARKETPLACE_PATH = '/claude-code/marketplace.json' as const
const CLAUDE_MARKETPLACE_SOURCE_KIND = {
  Url: 'url',
} as const

export const CLAUDE_MARKETPLACE_KEY = 'litellm' as const
export type ClaudeMarketplaceKey = typeof CLAUDE_MARKETPLACE_KEY

export const CLAUDE_SETTINGS_MODE = 0o600 as const

export type ClaudeMarketplaceAssetOptions = {
  readonly homeDirectory: string
  readonly gatewayOrigin: string
  readonly settingsPath?: string
}

export class ClaudeMarketplaceAssetError extends Error {
  readonly name = 'ClaudeMarketplaceAssetError'

  constructor(message: string, readonly path: string | undefined = undefined) {
    super(path === undefined ? message : `${message} (${path})`)
  }
}

export function planClaudeMarketplaceAsset(
  options: ClaudeMarketplaceAssetOptions,
): ClientInstallWriteAssetPlan {
  const path = options.settingsPath ?? resolveClaudeSettingsPath(options.homeDirectory)
  const marketplaceUrl = resolveClaudeMarketplaceUrl(options.gatewayOrigin)
  const plannedSource = readSettingsSource(path)
  const source = plannedSource.contents
  const settings = parseSettings(source, path)
  const marketplaces = readMarketplaces(settings, path)

  if (isEquivalentMarketplace(marketplaces[CLAUDE_MARKETPLACE_KEY], marketplaceUrl)) {
    return writeAsset(path, source, plannedSource.expectation)
  }

  const nextMarketplaces = {
    ...marketplaces,
    [CLAUDE_MARKETPLACE_KEY]: nextMarketplaceEntry(
      marketplaces[CLAUDE_MARKETPLACE_KEY],
      marketplaceUrl,
    ),
  }
  return writeAsset(
    path,
    `${JSON.stringify({
      ...settings,
      extraKnownMarketplaces: nextMarketplaces,
    }, null, 2)}\n`,
    plannedSource.expectation,
  )
}

export function resolveClaudeSettingsPath(homeDirectory: string): string {
  if (homeDirectory === '') {
    throw new ClaudeMarketplaceAssetError(
      'A non-empty home directory is required for Claude settings.',
    )
  }
  return join(homeDirectory, CLAUDE_SETTINGS_DIRECTORY, CLAUDE_SETTINGS_FILE)
}

export function resolveClaudeMarketplaceUrl(gatewayOrigin: string): string {
  const origin = normalizeOrigin(gatewayOrigin)
  if (origin === undefined) {
    throw new ClaudeMarketplaceAssetError(
      'The LiteLLM gateway origin must be an absolute http(s) origin without credentials, query, or fragment.',
    )
  }
  return `${origin}${CLAUDE_MARKETPLACE_PATH}`
}

function writeAsset(
  path: string,
  contents: string,
  expectation: ClientInstallExpectation,
): ClientInstallWriteAssetPlan {
  return {
    operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
    path,
    contents,
    mode: CLAUDE_SETTINGS_MODE,
    expectation,
  }
}

function readSettingsSource(path: string): {
  readonly contents: string
  readonly expectation: ClientInstallExpectation
} {
  const previous = readManagedFileSnapshot(path)
  return {
    contents: previous?.contents.toString('utf8') ?? '{}\n',
    expectation: { previous },
  }
}

function parseSettings(source: string, path: string): JsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new ClaudeMarketplaceAssetError(
      'Claude settings must contain valid JSON.',
      path,
    )
  }
  if (!isRecord(parsed)) {
    throw new ClaudeMarketplaceAssetError(
      'Claude settings JSON root must be an object.',
      path,
    )
  }
  return parsed
}

function readMarketplaces(settings: JsonObject, path: string): JsonObject {
  const value = settings.extraKnownMarketplaces
  if (value === undefined) return {}
  if (!isRecord(value)) {
    throw new ClaudeMarketplaceAssetError(
      'Claude settings extraKnownMarketplaces must be an object.',
      path,
    )
  }
  return value
}

function isEquivalentMarketplace(value: unknown, url: string): boolean {
  if (!isRecord(value) || !isRecord(value.source)) return false
  return value.url === undefined &&
    value.source.source === CLAUDE_MARKETPLACE_SOURCE_KIND.Url &&
    value.source.url === url
}

function nextMarketplaceEntry(value: unknown, url: string): JsonObject {
  const entry = isRecord(value) ? { ...value } : {}
  delete entry.url
  entry.source = {
    source: CLAUDE_MARKETPLACE_SOURCE_KIND.Url,
    url,
  }
  return entry
}

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
