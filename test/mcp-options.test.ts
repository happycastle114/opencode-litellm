import { describe, expect, test } from 'bun:test'
import {
  parseMcpDiscoveryOptions,
  parseMcpToolsetOptions,
} from '../src/mcp/options'

describe('LiteLLM MCP discovery options', () => {
  test('defaults to disabled when the option is omitted', () => {
    // Given: no MCP discovery option
    // When: plugin options are parsed
    const options = parseMcpDiscoveryOptions(undefined)

    // Then: MCP discovery is disabled with documented timeouts
    expect(options).toEqual({
      enabled: false,
      include: [],
      exclude: [],
      servers: [],
      timeoutMs: 3000,
      requestTimeoutMs: 15000,
    })
  })

  test('rejects toolset names containing a slash while allowing printable spaces', () => {
    // Given: a toolset path that Starlette cannot capture after URL decoding
    // When/Then: plugin options reject the unsafe path but retain ordinary spaces
    expect(parseMcpToolsetOptions({ toolsets: ['research core'] })).toEqual(['research core'])
    expect(() => parseMcpToolsetOptions({ toolsets: ['research/core'] }))
      .toThrow("without '/'")
  })

  test.each([
    ['non-object', { mcpDiscovery: [] }],
    ['unknown field', { mcpDiscovery: { enabled: true, wildcard: '*' } }],
    ['malformed include name', { mcpDiscovery: { include: ['Bad Name'] } }],
    ['duplicate include name', { mcpDiscovery: { include: ['zread', 'zread'] } }],
    [
      'duplicate server override',
      {
        mcpDiscovery: {
          servers: [{ serverName: 'zread' }, { serverName: 'zread' }],
        },
      },
    ],
    ['invalid discovery timeout', { mcpDiscovery: { timeoutMs: 5001 } }],
    ['invalid request timeout', { mcpDiscovery: { requestTimeoutMs: 0 } }],
  ])('rejects %s', (_label, options) => {
    // Given: malformed MCP discovery configuration
    // When/Then: plugin initialization rejects it
    expect(() => parseMcpDiscoveryOptions(options)).toThrow('mcpDiscovery')
  })

  test('parses include, exclude, and enabled overrides deterministically', () => {
    // Given: a selected set with one exclusion and two explicit states
    const raw = {
      mcpDiscovery: {
        enabled: true,
        include: ['minimax_search', 'zread', 'zai_web_reader'],
        exclude: ['zai_web_reader'],
        servers: [
          { serverName: 'minimax_search', enabled: false },
          { serverName: 'zread', enabled: true },
        ],
      },
    }

    // When: the option is parsed
    const options = parseMcpDiscoveryOptions(raw)

    // Then: exact selections and overrides are retained
    expect(options.enabled).toBe(true)
    expect(options.include).toEqual(['minimax_search', 'zread', 'zai_web_reader'])
    expect(options.exclude).toEqual(['zai_web_reader'])
    expect(options.servers).toEqual([
      { serverName: 'minimax_search', enabled: false },
      { serverName: 'zread', enabled: true },
    ])
  })
})
