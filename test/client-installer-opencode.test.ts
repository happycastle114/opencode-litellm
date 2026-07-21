import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { installPreparedClients } from '../src/cli/client-installer'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
} from '../src/cli/gateway-tool-discovery'
import {
  INSTALL_SELECTION_RESOURCE,
  INSTALL_SELECTION_WARNING_KIND,
} from '../src/cli/install-preparation'
import { InstallTarget } from '../src/cli/install-intent'
import { QWEN_GATEWAY_MODEL, resolveOhMyOpenAgentProfilePath } from '../src/cli/qwen-routing'
import {
  VALUE,
  createHomeDirectory,
  preparedInstall,
} from './client-installer-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = createHomeDirectory()
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('prepared client installer', () => {
  test('registers selected OpenCode resources through the managed plugin without persisting secrets', async () => {
    // Given: prepared, authenticated discovery with selected search, MCP, and toolset resources
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const base = preparedInstall({ target: InstallTarget.OpenCode, opencodeConfig: configPath })
    const prepared = {
      ...base,
      discovery: { ...base.discovery, warnings: [{
        resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
        endpoint: '/v1/search/tools',
      }] },
      selectionWarnings: [{
        kind: INSTALL_SELECTION_WARNING_KIND.NotVisible,
        resource: INSTALL_SELECTION_RESOURCE.Search,
        name: 'search-hidden',
      }],
    }

    // When: the canonical client installer applies the prepared selection
    const result = await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    // Then: the managed plugin owns runtime registration and only an env reference is durable
    const config = parseJsonc(readFileSync(configPath, 'utf8'))
    expect(result.configured).toEqual([{ client: InstallTarget.OpenCode, path: configPath }])
    expect(config.plugin[0][1]).toMatchObject({
      searchTools: [{ searchToolName: 'search-visible' }],
      mcpDiscovery: { include: ['mcp-visible'] },
      toolsets: ['toolset-visible'],
    })
    expect(config.provider.litellm.options.apiKey).toBe(`{env:${VALUE.AuthEnvironment}}`)
    expect(readFileSync(configPath, 'utf8')).not.toContain(VALUE.ApiKey)
    const openAgentProfile = parseJsonc(
      readFileSync(resolveOhMyOpenAgentProfilePath(configPath), 'utf8'),
    )
    expect(openAgentProfile.disabled_mcps).toEqual(['websearch'])
    expect(result.warnings).toEqual([
      "Selected search 'search-hidden' is not present in gateway discovery inventory and was skipped.",
      'Gateway search_tools discovery timed_out at /v1/search/tools; continuing with available resources.',
      `Qwen model routing skipped: gateway model '${QWEN_GATEWAY_MODEL}' was not discovered; Oh My OpenAgent built-in websearch is disabled at ${resolveOhMyOpenAgentProfilePath(configPath)}.`,
    ])
    expect(JSON.stringify(result.warnings)).not.toContain(VALUE.ApiKey)
  })
})
