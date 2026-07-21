import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import type { PreparedInstall } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault } from '../src/cli/install-intent'

export const VALUE = {
  ApiKey: 'sk-installer-secret',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

export const PLATFORM = { Darwin: 'darwin' } as const

export const BUNDLED_CATALOG = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})

export function createHomeDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'client-installer-'))
}

export function preparedInstall(
  overrides: Partial<PreparedInstall['options']>,
): PreparedInstall {
  return {
    options: {
      target: InstallTarget.Codex,
      baseUrl: VALUE.GatewayOrigin,
      auth: InstallAuth.Environment,
      authEnv: VALUE.AuthEnvironment,
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: CodexMode.Both,
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: ['search-visible'],
      mcp: ['mcp-visible'],
      toolsets: ['toolset-visible'],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
      ...overrides,
    },
    apiKey: VALUE.ApiKey,
    discovery: {
      models: [{ id: 'gateway-model' }],
      searchToolNames: ['search-visible'],
      mcpServerNames: ['mcp-visible'],
      toolsets: [{ toolsetId: 'toolset-id', toolsetName: 'toolset-visible' }],
      warnings: [],
    },
    selectionWarnings: [],
  }
}

export function bundledCatalog(): typeof BUNDLED_CATALOG {
  return BUNDLED_CATALOG
}
