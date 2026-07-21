import { describe, expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import { LiteLLMPlugin } from '../src/index'
import {
  baseIntent,
  render,
} from './opencode-config-test-support'

describe('opencode resource editing', () => {
  test('preserves unknown LiteLLM tuple options while replacing managed tool options', () => {
    const source = JSON.stringify({
      plugin: [['opencode-plugin-litellm@0.6.0', {
        telemetry: { enabled: false },
        searchTools: [{ toolName: 'stale', searchToolName: 'stale-search' }],
        mcpDiscovery: { enabled: true, include: ['stale-mcp'] },
        toolsets: ['stale toolset'],
      }]],
    })
    const intent = { ...baseIntent, search: ['agy-search'], mcp: ['zread'] } as const
    const parsed = parseJsonc(render(source, intent))

    expect(parsed.plugin[0][1]).toEqual({
      telemetry: { enabled: false },
      searchTools: [{
        toolName: 'litellm_search',
        searchToolName: 'agy-search',
        defaultMaxResults: 8,
      }],
      mcpDiscovery: {
        enabled: true,
        include: ['zread'],
        servers: [],
      },
    })
  })

  test('emits a search tuple when search options are enabled', () => {
    const intent = { ...baseIntent, search: ['agy-search'] } as const
    const parsed = parseJsonc(render('{}', intent))
    const entry = (parsed.plugin as unknown[])[0]

    expect(Array.isArray(entry)).toBe(true)
    if (!Array.isArray(entry)) return
    expect(entry[1].searchTools).toEqual([{
      toolName: 'litellm_search',
      searchToolName: 'agy-search',
      defaultMaxResults: 8,
    }])
  })

  test('emits deterministic non-reserved IDs for literal websearch and normalization collisions', () => {
    const intent = {
      ...baseIntent,
      search: ['agy-search', 'websearch', 'exa-search', 'exa_search'],
    } as const
    const parsed = parseJsonc(render('{}', intent))

    expect(parsed.plugin[0][1].searchTools).toEqual([
      { toolName: 'litellm_search', searchToolName: 'agy-search', defaultMaxResults: 8 },
      { toolName: 'litellm_websearch', searchToolName: 'websearch', defaultMaxResults: 8 },
      { toolName: 'litellm_exa_search', searchToolName: 'exa-search', defaultMaxResults: 8 },
      { toolName: 'litellm_exa_search_2', searchToolName: 'exa_search', defaultMaxResults: 8 },
    ])
    expect(parsed.plugin[0][1].searchTools.every(
      (entry: { readonly toolName: string }) => entry.toolName !== 'websearch',
    )).toBe(true)
  })

  test('initializes with agy-search and literal websearch without duplicate tool IDs', async () => {
    const intent = { ...baseIntent, search: ['agy-search', 'websearch'] } as const
    const parsed = parseJsonc(render('{}', intent))
    const options = parsed.plugin[0][1]

    const hooks = await LiteLLMPlugin({}, options)

    expect(Object.keys(hooks.tool ?? {})).toEqual(['litellm_search', 'litellm_websearch'])
  })

  test('emits an mcpDiscovery block when mcp options are enabled', () => {
    const intent = {
      ...baseIntent,
      mcp: ['zread', 'zai-web-reader'],
      disableMcp: ['minimax-search'],
    } as const
    const parsed = parseJsonc(render('{}', intent))
    const entry = (parsed.plugin as unknown[])[0]

    expect(Array.isArray(entry)).toBe(true)
    if (!Array.isArray(entry)) return
    const options = entry[1]
    expect(options.mcpDiscovery.enabled).toBe(true)
    expect(options.mcpDiscovery.include).toEqual(['zread', 'zai-web-reader'])
    expect(options.mcpDiscovery.servers).toEqual([
      { serverName: 'minimax-search', enabled: false },
    ])
  })

  test('does not persist model lists or discovered mcp state', () => {
    const intent = { ...baseIntent, search: ['agy-search'], mcp: ['zread'] } as const
    const output = render('{}', intent)
    const parsed = parseJsonc(output)

    expect(parsed.provider.litellm.models).toBeUndefined()
    expect(parsed.mcp).toBeUndefined()
    expect(output).not.toContain('/mcp')
  })

  test('is idempotent across repeated applies', () => {
    const intent = { ...baseIntent, search: ['agy-search'], mcp: ['zread'] } as const
    const once = render('{}', intent)
    const twice = render(once, intent)

    expect(twice).toBe(once)
  })
})
