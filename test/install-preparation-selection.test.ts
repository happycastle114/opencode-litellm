import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  type GatewayToolDiscoveryResult,
} from '../src/cli/gateway-tool-discovery'
import { prepareInstall } from '../src/cli/install-preparation'
import {
  boundary,
  DISCOVERY,
  INSTALL_SELECTION_RESOURCE,
  INSTALL_SELECTION_WARNING_KIND,
  installOptions,
  VALUE,
  warning,
} from './install-preparation-test-support'
import { InstallAuth } from '../src/cli/install-intent'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-selection-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation selection', () => {
  test('keeps explicit filters visible, warns for hidden names, and honors opt-outs', async () => {
    const options = installOptions({
      auth: InstallAuth.Environment,
      nonInteractive: true,
      search: ['search-hidden', 'search-visible'],
      mcp: ['mcp-hidden', 'mcp-visible', 'mcp-second'],
      toolsets: ['toolset-hidden', 'toolset-visible'],
      disableMcp: ['disabled-hidden', 'mcp-second'],
      noToolsets: true,
    })
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => DISCOVERY,
    }))

    expect(prepared.options).toMatchObject({
      search: ['search-visible'],
      mcp: ['mcp-visible', 'mcp-second'],
      toolsets: [],
      disableMcp: ['mcp-second'],
    })
    expect(prepared.selectionWarnings).toEqual([
      warning(INSTALL_SELECTION_RESOURCE.Search, 'search-hidden'),
      warning(INSTALL_SELECTION_RESOURCE.Mcp, 'mcp-hidden'),
      warning(INSTALL_SELECTION_RESOURCE.DisabledMcp, 'disabled-hidden'),
    ])
  })

  test('retains explicit optional names when their discovery endpoints are unavailable', async () => {
    const options = installOptions({
      auth: InstallAuth.Environment,
      nonInteractive: true,
      search: ['agy-search', 'second-search', 'agy-search'],
      mcp: ['mcp-hidden'],
      toolsets: ['research/core', 'ops-review', 'research/core'],
    })
    const discovery: GatewayToolDiscoveryResult = {
      ...DISCOVERY,
      searchToolNames: [], mcpServerNames: [], toolsets: [],
      warnings: [
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: '/v1/search/tools', status: 403,
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unsupported,
          endpoint: '/v1/mcp/toolset', status: 403,
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.McpServers,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: '/v1/mcp/server',
        },
      ],
    }
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => discovery,
    }))

    expect(prepared.options).toMatchObject({
      search: ['agy-search', 'second-search'],
      mcp: [],
      toolsets: ['research/core', 'ops-review'],
    })
    expect(prepared.selectionWarnings).toEqual([
      warning(INSTALL_SELECTION_RESOURCE.Search, 'agy-search', INSTALL_SELECTION_WARNING_KIND.Unverified),
      warning(INSTALL_SELECTION_RESOURCE.Search, 'second-search', INSTALL_SELECTION_WARNING_KIND.Unverified),
      warning(INSTALL_SELECTION_RESOURCE.Mcp, 'mcp-hidden'),
      warning(INSTALL_SELECTION_RESOURCE.Toolset, 'research/core', INSTALL_SELECTION_WARNING_KIND.Unverified),
      warning(INSTALL_SELECTION_RESOURCE.Toolset, 'ops-review', INSTALL_SELECTION_WARNING_KIND.Unverified),
    ])
  })

  test('keeps optional categories empty when failed discovery has no explicit names', async () => {
    const options = installOptions({ auth: InstallAuth.Environment, nonInteractive: true })
    const discovery: GatewayToolDiscoveryResult = {
      ...DISCOVERY,
      warnings: [
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: '/v1/search/tools',
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
          endpoint: '/v1/mcp/toolset',
        },
      ],
    }
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => discovery,
    }))

    expect(prepared.options).toMatchObject({ search: [], toolsets: [] })
    expect(prepared.selectionWarnings).toEqual([])
  })

  test('keeps successful discovery strict for typo names and deduplicates warnings', async () => {
    const options = installOptions({
      auth: InstallAuth.Environment,
      nonInteractive: true,
      search: ['search-typo', 'search-visible', 'search-typo'],
      toolsets: ['toolset-typo', 'toolset-second', 'toolset-typo'],
    })
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => ({
        ...DISCOVERY,
        warnings: [{
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback,
          endpoint: '/v1/search/tools',
        }],
      }),
    }))

    expect(prepared.options).toMatchObject({
      search: ['search-visible'],
      toolsets: ['toolset-second'],
    })
    expect(prepared.selectionWarnings).toEqual([
      warning(INSTALL_SELECTION_RESOURCE.Search, 'search-typo'),
      warning(INSTALL_SELECTION_RESOURCE.Toolset, 'toolset-typo'),
    ])
  })

  test('disabled search and toolset flags override explicit fallback names', async () => {
    const options = installOptions({
      auth: InstallAuth.Environment,
      nonInteractive: true,
      search: ['agy-search'],
      toolsets: ['research/core'],
      noSearch: true,
      noToolsets: true,
    })
    const discovery: GatewayToolDiscoveryResult = {
      ...DISCOVERY,
      searchToolNames: [], toolsets: [],
      warnings: [
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: '/v1/search/tools',
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
          endpoint: '/v1/mcp/toolset',
        },
      ],
    }
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { [VALUE.envName]: VALUE.apiKey },
      discover: async () => discovery,
    }))

    expect(prepared.options).toMatchObject({ search: [], toolsets: [] })
    expect(prepared.selectionWarnings).toEqual([])
  })
})
