import { describe, expect, test } from 'bun:test'
import { parseCliArgs } from '../src/cli/command'
import type { GatewayToolDiscoveryResult } from '../src/cli/gateway-tool-discovery'
import {
  INSTALL_SELECTION_RESOURCE,
  INSTALL_SELECTION_WARNING_KIND,
  selectDisabledMcp,
  selectInstallResources,
} from '../src/cli/install-preparation-selection'
import {
  CodexMode,
  InstallAuth,
  InstallTarget,
  McpServerId,
  ToolkitDefault,
  resolveInstallIntent,
  type InstallOptions,
} from '../src/cli/install-intent'

const MCP = {
  Zread: 'zread',
  ZaiWebReader: 'zai_web_reader',
  UnknownEnable: 'unknown_enable',
  UnknownDisable: 'unknown_disable',
} as const

const DISCOVERY: GatewayToolDiscoveryResult = {
  models: [],
  searchToolNames: [],
  mcpServerNames: [McpServerId.MinimaxSearch, MCP.Zread, MCP.ZaiWebReader],
  toolsets: [],
  warnings: [],
}

describe('MCP installer default state policy', () => {
  test('rejects one MCP server in both explicit state lists', () => {
    // Given: contradictory repeatable state overrides
    // When: install arguments are parsed
    const parsed = parseCliArgs([
      'install', '--enable-mcp', McpServerId.MinimaxSearch,
      '--disable-mcp', McpServerId.MinimaxSearch,
    ])

    // Then: the contradiction is rejected at the CLI boundary
    expect(parsed).toEqual({
      kind: 'error',
      message: `MCP server '${McpServerId.MinimaxSearch}' cannot be both enabled and disabled.`,
    })
  })

  test('disables only selected minimax_search when no state flags are supplied', () => {
    // Given: all three known MCP servers are visible and selected by default
    // When: installer resources are selected without state overrides
    const selected = selectInstallResources(options(), DISCOVERY)

    // Then: all servers are included, while only minimax_search starts disabled
    expect(selected.mcp.names).toEqual(DISCOVERY.mcpServerNames)
    expect(selected.disabledMcp.names).toEqual([McpServerId.MinimaxSearch])
  })

  test('explicit enable removes the minimax_search default disable', () => {
    // Given: the default-disabled server is explicitly enabled
    // When: installer resources are selected
    const selected = selectInstallResources(
      options({ enableMcp: [McpServerId.MinimaxSearch] }),
      DISCOVERY,
    )

    // Then: no selected server is disabled
    expect(selected.disabledMcp.names).toEqual([])
  })

  test('explicit disable adds an enabled-by-default selected server', () => {
    // Given: zread is explicitly disabled
    // When: installer resources are selected
    const selected = selectInstallResources(options({ disableMcp: [MCP.Zread] }), DISCOVERY)

    // Then: policy and explicit disabled states are both applied in discovery order
    expect(selected.disabledMcp.names).toEqual([McpServerId.MinimaxSearch, MCP.Zread])
  })

  test('does not create a default-disabled server absent from discovery', () => {
    // Given: discovery does not expose the policy server
    const discovery = { ...DISCOVERY, mcpServerNames: [MCP.Zread, MCP.ZaiWebReader] }

    // When: installer resources are selected without state flags
    const selected = selectInstallResources(options(), discovery)

    // Then: nothing is disabled by invention
    expect(selected.disabledMcp.names).toEqual([])
  })

  test('keeps --mcp as inclusion only even when another visible server is enabled', () => {
    // Given: zread is the only included server while minimax_search receives a state override
    const selected = selectInstallResources(options({
      mcp: [MCP.Zread],
      enableMcp: [McpServerId.MinimaxSearch],
    }), DISCOVERY)

    // When/Then: the state override cannot add minimax_search to the inclusion set
    expect(selected.mcp.names).toEqual([MCP.Zread])
    expect(selected.disabledMcp.names).toEqual([])
  })

  test('warns for unknown state names without inventing MCP servers', () => {
    // Given: both state lists contain names absent from authenticated discovery
    const selected = selectInstallResources(options({
      enableMcp: [MCP.UnknownEnable],
      disableMcp: [MCP.UnknownDisable],
    }), DISCOVERY)

    // When/Then: selected and disabled servers stay discovery-backed and warnings identify each list
    expect(selected.mcp.names).toEqual(DISCOVERY.mcpServerNames)
    expect(selected.disabledMcp.names).toEqual([McpServerId.MinimaxSearch])
    expect(selected.disabledMcp.warnings).toEqual([
      {
        kind: INSTALL_SELECTION_WARNING_KIND.NotVisible,
        resource: INSTALL_SELECTION_RESOURCE.EnabledMcp,
        name: MCP.UnknownEnable,
      },
      {
        kind: INSTALL_SELECTION_WARNING_KIND.NotVisible,
        resource: INSTALL_SELECTION_RESOURCE.DisabledMcp,
        name: MCP.UnknownDisable,
      },
    ])
  })

  test('--no-mcp clears inclusion, state, and state warnings', () => {
    // Given: MCP is disabled despite explicit state names
    const selected = selectInstallResources(options({
      noMcp: true,
      enableMcp: [MCP.UnknownEnable],
      disableMcp: [MCP.Zread],
    }), DISCOVERY)

    // When/Then: MCP selection is completely empty
    expect(selected.mcp).toEqual({ names: [], warnings: [] })
    expect(selected.disabledMcp).toEqual({ names: [], warnings: [] })
  })

  test('--no-mcp clears explicit state directives from the resolved intent', () => {
    // Given: valid but irrelevant state overrides accompany the MCP opt-out
    // When: the typed install intent is resolved
    const resolved = resolveInstallIntent(options({
      noMcp: true,
      mcp: [MCP.Zread],
      enableMcp: [McpServerId.MinimaxSearch],
      disableMcp: [MCP.Zread],
    }))

    // Then: no MCP inclusion or state directive survives
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.intent.opencode).toMatchObject({
      mcp: [], enableMcp: [], disableMcp: [],
    })
  })

  test('uses the same policy against the interactive plan selection', () => {
    // Given: onboarding selected only zread from the same discovery result
    // When: disabled-state selection is resolved against that plan
    const disabled = selectDisabledMcp(options(), DISCOVERY, [MCP.Zread])

    // Then: an unselected minimax_search is not emitted as disabled
    expect(disabled.names).toEqual([])
  })
})

function options(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    target: InstallTarget.OpenCode,
    baseUrl: 'https://litellm.example.com',
    auth: InstallAuth.Environment,
    authEnv: 'TEST_LITELLM_KEY',
    nonInteractive: true,
    opencodeConfig: undefined,
    codexConfig: undefined,
    codexMode: CodexMode.Both,
    autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
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
