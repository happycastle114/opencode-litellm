import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { installPreparedClients } from '../src/cli/client-installer'
import {
  INSTALL_SELECTION_RESOURCE,
  INSTALL_SELECTION_WARNING_KIND,
  type PreparedInstall,
} from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
} from '../src/cli/gateway-tool-discovery'
import { QWEN_GATEWAY_MODEL } from '../src/cli/qwen-routing'

const VALUE = {
  ApiKey: 'sk-warning-output-secret',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const

test('reports explicit optional resources as configured without verification when discovery is unavailable', async () => {
  // Given: explicit search and toolset selections retained after optional discovery failures
  const homeDirectory = mkdtempSync(join(tmpdir(), 'client-installer-warning-'))
  const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
  const prepared: PreparedInstall = {
    options: {
      target: InstallTarget.OpenCode,
      baseUrl: VALUE.GatewayOrigin,
      auth: InstallAuth.Environment,
      authEnv: VALUE.AuthEnvironment,
      nonInteractive: true,
      opencodeConfig: configPath,
      codexConfig: undefined,
      codexMode: CodexMode.Both,
      search: ['agy-search'],
      mcp: [],
      toolsets: ['research/core'],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    },
    apiKey: VALUE.ApiKey,
    discovery: {
      models: [{ id: QWEN_GATEWAY_MODEL }],
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
          endpoint: '/v1/search/tools',
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback,
          endpoint: '/v1/search/tools',
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: '/v1/mcp/toolset',
          status: 403,
        },
      ],
    },
    selectionWarnings: [
      {
        kind: INSTALL_SELECTION_WARNING_KIND.Unverified,
        resource: INSTALL_SELECTION_RESOURCE.Search,
        name: 'agy-search',
      },
      {
        kind: INSTALL_SELECTION_WARNING_KIND.Unverified,
        resource: INSTALL_SELECTION_RESOURCE.Toolset,
        name: 'research/core',
      },
    ],
  }

  try {
    // When: the prepared OpenCode installation is applied
    const result = await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    // Then: both explicit resources are configured and the output never claims they were skipped
    const config = parseJsonc(readFileSync(configPath, 'utf8'))
    expect(config.plugin[0][1]).toMatchObject({
      searchTools: [{ searchToolName: 'agy-search' }],
      toolsets: ['research/core'],
    })
    expect(result.warnings.slice(0, 2)).toEqual([
      "Gateway search discovery was unavailable; selected 'agy-search' was configured without verification.",
      "Gateway toolset discovery was unavailable; selected 'research/core' was configured without verification.",
    ])
    expect(result.warnings.slice(0, 2).join('\n')).not.toContain('skipped')
    expect(result.warnings).toContain(
      'Gateway search_tools discovery used router-wide inventory at /v1/search/tools; invocation POST enforces gateway permissions.',
    )
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true })
  }
})
