import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  discoverGatewayTools,
} from '../src/cli/gateway-tool-discovery'
import { API_KEY, ENDPOINT, ORIGIN } from './gateway-tool-discovery-test-support'

describe('LiteLLM gateway tool discovery responses', () => {
  test('keeps model discovery fatal without exposing the API key', async () => {
    // Given: only the required model catalog is unavailable
    const fetcher: typeof fetch = async (input) => {
      switch (new URL(String(input)).pathname) {
        case ENDPOINT.Models:
          return new Response('internal details', { status: 503 })
        case ENDPOINT.McpServers:
          return Response.json([])
        case ENDPOINT.SearchToolsAuthorized:
          return Response.json({ search_tools: [] })
        case ENDPOINT.Toolsets:
          return Response.json([])
        default:
          return new Response(null, { status: 404 })
      }
    }

    // When/Then: optional resources cannot hide the required model failure
    const pending = discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher })
    await expect(pending).rejects.toThrow(/model discovery/i)
    await expect(discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher }))
      .rejects.toThrow(new RegExp(`^(?!.*${API_KEY}).*$`))
  })

  test.each([404, 405])(
    'classifies an HTTP %i toolset endpoint as unsupported and degrades other optional failures',
    async (toolsetStatus) => {
      // Given: models work while MCP, search, and toolsets are independently unavailable
      const fetcher: typeof fetch = async (input) => {
        switch (new URL(String(input)).pathname) {
          case ENDPOINT.Models:
            return Response.json({ data: [{ id: 'gateway/model-a' }] })
          case ENDPOINT.McpServers:
            return new Response(null, { status: 502 })
          case ENDPOINT.SearchToolsAuthorized:
            return new Response(null, { status: 403 })
          case ENDPOINT.SearchToolsAvailable:
            return Response.json({ object: 'list', data: 'invalid' })
          case ENDPOINT.Toolsets:
            return new Response(null, { status: toolsetStatus })
          default:
            return new Response(null, { status: 404 })
        }
      }

      // When: optional discovery endpoints fail
      const result = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher })

      // Then: model onboarding survives with typed, secret-safe degradation evidence
      expect(result.models).toEqual([{ id: 'gateway/model-a' }])
      expect(result.mcpServerNames).toEqual([])
      expect(result.searchToolNames).toEqual([])
      expect(result.toolsets).toEqual([])
      expect(result.warnings).toEqual([
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.McpServers,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
          endpoint: ENDPOINT.McpServers,
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
          endpoint: ENDPOINT.SearchToolsAvailable,
        },
        {
          resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
          kind: GATEWAY_DISCOVERY_WARNING_KIND.Unsupported,
          endpoint: ENDPOINT.Toolsets,
          status: toolsetStatus,
        },
      ])
      expect(JSON.stringify(result.warnings)).not.toContain(API_KEY)
    },
  )

  test('strictly rejects malformed optional rows while accepting empty available lists', async () => {
    // Given: strict schemas can be selected independently
    const makeFetcher = (malformedEndpoint?: string): typeof fetch => async (input) => {
      const endpoint = new URL(String(input)).pathname
      if (endpoint === ENDPOINT.Models) return Response.json({ data: [{ id: 'gateway/model-a' }] })
      if (endpoint === ENDPOINT.McpServers) return Response.json([])
      if (endpoint === ENDPOINT.SearchToolsAuthorized) {
        if (malformedEndpoint === ENDPOINT.SearchToolsAvailable) {
          return new Response(null, { status: 403 })
        }
        return malformedEndpoint === endpoint
          ? Response.json({ search_tools: [{ search_tool_name: 'Bad Name' }] })
          : Response.json({ search_tools: [] })
      }
      if (endpoint === ENDPOINT.SearchToolsAvailable) {
        return malformedEndpoint === endpoint
          ? Response.json({ object: 'list', data: [{ search_tool_name: 'Bad Name' }] })
          : Response.json({ object: 'list', data: [] })
      }
      if (endpoint === ENDPOINT.Toolsets) {
        return malformedEndpoint === endpoint
          ? Response.json([{ toolset_id: 'slash-name', toolset_name: 'research/core' }])
          : Response.json([])
      }
      return new Response(null, { status: 404 })
    }

    // When: valid empty lists represent no available resources
    const empty = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher: makeFetcher() })

    // Then: empty grants are not errors, but malformed rows are structured warnings
    expect(empty.searchToolNames).toEqual([])
    expect(empty.toolsets).toEqual([])
    expect(empty.warnings).toEqual([])
    const authorizedInvalid = await discoverGatewayTools({
      origin: ORIGIN,
      apiKey: API_KEY,
      fetcher: makeFetcher(ENDPOINT.SearchToolsAuthorized),
    })
    expect(authorizedInvalid.warnings).toContainEqual({
      resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback,
      endpoint: ENDPOINT.SearchToolsAvailable,
    })
    for (const endpoint of [ENDPOINT.SearchToolsAvailable, ENDPOINT.Toolsets]) {
      const result = await discoverGatewayTools({
        origin: ORIGIN,
        apiKey: API_KEY,
        fetcher: makeFetcher(endpoint),
      })
      expect(result.warnings).toContainEqual({
        resource: endpoint === ENDPOINT.SearchToolsAuthorized || endpoint === ENDPOINT.SearchToolsAvailable
          ? GATEWAY_DISCOVERY_RESOURCE.SearchTools
          : GATEWAY_DISCOVERY_RESOURCE.Toolsets,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
        endpoint,
      })
    }
  })

  test.each([
    { object: 'collection', data: [] },
    { object: 'list' },
    { object: 'list', data: {} },
    { search_tools: [{ search_tool_name: 'management-only' }] },
    { object: 'list', data: [null] },
    { object: 'list', data: [{}] },
    { object: 'list', data: [{ search_tool_name: '' }] },
    { object: 'list', data: [{ search_tool_name: 42 }] },
    { object: 'list', data: [{ search_tool_name: 'Bad Name' }] },
    { object: 'list', data: [{ search_tool_name: 'search/tool' }] },
    { object: 'list', data: [{ search_tool_name: ' search ' }] },
  ])('strictly rejects a malformed public search response', async (searchPayload) => {
    // Given: the public search endpoint returns a malformed envelope or row
    const fetcher: typeof fetch = async (input) => {
      switch (new URL(String(input)).pathname) {
        case ENDPOINT.Models:
          return Response.json({ data: [{ id: 'gateway/model-a' }] })
        case ENDPOINT.McpServers:
          return Response.json([])
        case ENDPOINT.SearchToolsAvailable:
          return Response.json(searchPayload)
        case ENDPOINT.Toolsets:
          return Response.json([])
        default:
          return new Response(null, { status: 404 })
      }
    }

    // When: authenticated gateway discovery parses the public response
    const result = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher })

    // Then: malformed public data is isolated as an exact-endpoint warning
    expect(result.searchToolNames).toEqual([])
    expect(result.warnings).toContainEqual({
      resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
      endpoint: ENDPOINT.SearchToolsAvailable,
    })
  })
})
