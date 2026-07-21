import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  discoverGatewayTools,
} from '../src/cli/gateway-tool-discovery'
import { API_KEY, ENDPOINT, ORIGIN } from './gateway-tool-discovery-test-support'

describe('LiteLLM gateway tool discovery routing', () => {
  test('rejects an empty API key before starting any request', async () => {
    // Given: discovery has no authenticated gateway credential
    let requestCount = 0
    const fetcher: typeof fetch = async () => {
      requestCount += 1
      return Response.json({ data: [{ id: 'unexpected' }] })
    }

    // When/Then: all authenticated discovery endpoints remain untouched
    await expect(discoverGatewayTools({ origin: ORIGIN, apiKey: '  ', fetcher }))
      .rejects.toThrow(/api key/i)
    expect(requestCount).toBe(0)
  })

  test('uses the authorized search route without probing the fallback', async () => {
    // Given: every authenticated endpoint exposes available rows with duplicates
    const started: string[] = []
    const resolvers: Array<() => void> = []
    const fetcher: typeof fetch = async (input, init) => {
      const endpoint = new URL(String(input)).pathname
      started.push(endpoint)
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      switch (endpoint) {
        case ENDPOINT.Models:
          return Response.json({ data: [
            { id: 'gateway/model-a', object: 'model' },
            { id: 'gateway/model-a', object: 'model' },
          ] })
        case ENDPOINT.McpServers:
          return Response.json([{ server_name: 'research_docs' }])
        case ENDPOINT.SearchToolsAuthorized:
          return Response.json({ search_tools: [
            { search_tool_name: 'search' },
            { search_tool_name: 'search' },
            { search_tool_name: 'agy-search' },
          ] })
        case ENDPOINT.Toolsets:
          return Response.json([
            { toolset_id: 'ts-research', toolset_name: 'research', tools: [] },
            { toolset_id: 'ts-research', toolset_name: 'research', tools: [] },
            { toolset_id: 'ts-coding', toolset_name: 'coding', tools: [] },
          ])
        default:
          return new Response(null, { status: 404 })
      }
    }

    // When: discovery starts but responses remain gated
    const pending = discoverGatewayTools({ origin: `${ORIGIN}/v1/`, apiKey: API_KEY, fetcher })
    await Promise.resolve()

    // Then: all four requests start before any is released
    expect(started).toEqual(expect.arrayContaining([
      ENDPOINT.Models,
      ENDPOINT.McpServers,
      ENDPOINT.SearchToolsAuthorized,
      ENDPOINT.Toolsets,
    ]))
    expect(started).toHaveLength(4)
    expect(started).not.toContain(ENDPOINT.SearchToolsAvailable)
    resolvers.forEach((resolve) => resolve())
    await expect(pending).resolves.toEqual({
      models: [{ id: 'gateway/model-a', object: 'model' }],
      mcpServerNames: ['research_docs'],
      searchToolNames: ['agy-search', 'search'],
      toolsets: [
        { toolsetId: 'ts-research', toolsetName: 'research' },
        { toolsetId: 'ts-coding', toolsetName: 'coding' },
      ],
      warnings: [],
    })
  })

  test('uses router-wide search inventory after a permission-denied authorized route', async () => {
    // Given: the filtered management route is denied while the public inventory is available
    const started: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const endpoint = new URL(String(input)).pathname
      started.push(endpoint)
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
      switch (endpoint) {
        case ENDPOINT.Models:
          return Response.json({ data: [{ id: 'gateway/model-a' }] })
        case ENDPOINT.McpServers:
          return Response.json([])
        case ENDPOINT.SearchToolsAuthorized:
          return new Response(null, { status: 403 })
        case ENDPOINT.SearchToolsAvailable:
          return Response.json({ object: 'list', data: [
            { search_tool_name: 'search-z' },
            { search_tool_name: 'search-a' },
            { search_tool_name: 'search-z' },
          ] })
        case ENDPOINT.Toolsets:
          return Response.json([])
        default:
          return new Response(null, { status: 404 })
      }
    }

    // When: authenticated discovery is run against the live-like route behavior
    const result = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher })

    // Then: fallback inventory is sorted/deduplicated and marked as router-wide
    expect(started).toContain(ENDPOINT.SearchToolsAuthorized)
    expect(started).toContain(ENDPOINT.SearchToolsAvailable)
    expect(result.searchToolNames).toEqual(['search-a', 'search-z'])
    expect(result.warnings).toEqual([{
      resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback,
      endpoint: ENDPOINT.SearchToolsAvailable,
    }])
  })

  test.each([404, 405])(
    'preserves fallback HTTP %i status when both search routes fail',
    async (availableStatus) => {
      // Given: both the permission-filtered and router-wide search routes fail
      const fetcher: typeof fetch = async (input) => {
        switch (new URL(String(input)).pathname) {
          case ENDPOINT.Models:
            return Response.json({ data: [{ id: 'gateway/model-a' }] })
          case ENDPOINT.McpServers:
            return Response.json([])
          case ENDPOINT.SearchToolsAuthorized:
            return new Response(null, { status: 403 })
          case ENDPOINT.SearchToolsAvailable:
            return new Response(null, { status: availableStatus })
          case ENDPOINT.Toolsets:
            return Response.json([])
          default:
            return new Response(null, { status: 404 })
        }
      }

      // When: optional search discovery is attempted
      const result = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher })

      // Then: the final endpoint and status remain visible to optional failure handling
      expect(result.searchToolNames).toEqual([])
      expect(result.warnings).toContainEqual({
        resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint: ENDPOINT.SearchToolsAvailable,
        status: availableStatus,
      })
    },
  )
})
