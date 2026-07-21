import { mkdirSync, writeFileSync } from 'node:fs'
import type { GatewayToolDiscoveryResult } from '../src/cli/gateway-tool-discovery'
import {
  INSTALL_SELECTION_RESOURCE,
  INSTALL_SELECTION_WARNING_KIND,
  type InstallPreparationBoundary,
} from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault, type InstallOptions } from '../src/cli/install-intent'
import { join } from 'node:path'

export const VALUE = {
  defaultOrigin: 'https://default.example.test',
  changedOrigin: 'https://changed.example.test',
  otherOrigin: 'https://other.example.test',
  apiKey: 'sk-preparation-secret',
  envName: 'TEST_LITELLM_KEY',
} as const

export const DISCOVERY: GatewayToolDiscoveryResult = {
  models: [{ id: 'coding-fast' }],
  searchToolNames: ['search-visible', 'search-second'],
  mcpServerNames: ['mcp-visible', 'mcp-second'],
  toolsets: [
    { toolsetId: 'ts-visible', toolsetName: 'toolset-visible' },
    { toolsetId: 'ts-second', toolsetName: 'toolset-second' },
  ],
  warnings: [],
}

export function installOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    target: InstallTarget.OpenCode,
    baseUrl: VALUE.defaultOrigin,
    auth: InstallAuth.Sso,
    authEnv: VALUE.envName,
    nonInteractive: false,
    opencodeConfig: undefined,
    codexConfig: undefined,
    codexMode: CodexMode.Both,
    autoRouter: ToolkitDefault.InteractiveAutoRouter,
    search: [],
    mcp: [],
    toolsets: [],
    enableMcp: [], disableMcp: [],
    noSearch: false,
    noMcp: false,
    noToolsets: false,
    ...overrides,
  }
}

export function boundary(
  homeDirectory: string,
  overrides: Partial<InstallPreparationBoundary> = {},
): InstallPreparationBoundary {
  return {
    env: {},
    home: () => homeDirectory,
    now: () => 123_000,
    ssoBoundaries: { open: async () => undefined, selectTeam: async () => undefined },
    ...overrides,
  }
}

export function writeToken(homeDirectory: string, origin: string): void {
  const directory = join(homeDirectory, '.litellm')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'token.json'), JSON.stringify({
    base_url: origin,
    key: VALUE.apiKey,
  }))
}

export function warning(
  resource: string,
  name: string,
  kind: typeof INSTALL_SELECTION_WARNING_KIND[keyof typeof INSTALL_SELECTION_WARNING_KIND] = INSTALL_SELECTION_WARNING_KIND.NotVisible,
) {
  return { kind, resource, name }
}

export { INSTALL_SELECTION_RESOURCE, INSTALL_SELECTION_WARNING_KIND }
