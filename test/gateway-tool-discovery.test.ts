import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  discoverGatewayTools,
} from '../src/cli/gateway-tool-discovery'

const ENDPOINT = {
  Models: '/v1/models',
  McpServers: '/v1/mcp/server',
  SearchTools: '/search_tools/list',
  Toolsets: '/v1/mcp/toolset',
} as const

const ORIGIN = 'https://gateway.example.test'
const API_KEY = 'gateway-tool-discovery-secret'

describe('LiteLLM gateway tool discovery', () => {
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

  test('starts all independent requests concurrently and returns unique authorized resources', async () => {
    // Given: every authenticated endpoint exposes authorized rows with duplicates
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
        case ENDPOINT.SearchTools:
          return Response.json({ search_tools: [
            { search_tool_name: 'agy-search', litellm_params: {} },
            { search_tool_name: 'agy-search', litellm_params: { api_base: 'masked' } },
            { search_tool_name: 'search', litellm_params: {} },
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
    expect(started).toEqual(expect.arrayContaining(Object.values(ENDPOINT)))
    expect(started).toHaveLength(4)
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

  test('keeps model discovery fatal without exposing the API key', async () => {
    // Given: only the required model catalog is unavailable
    const fetcher: typeof fetch = async (input) => {
      switch (new URL(String(input)).pathname) {
        case ENDPOINT.Models:
          return new Response('internal details', { status: 503 })
        case ENDPOINT.McpServers:
          return Response.json([])
        case ENDPOINT.SearchTools:
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
          case ENDPOINT.SearchTools:
            return Response.json({ search_tools: 'invalid' })
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
          endpoint: ENDPOINT.SearchTools,
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

  test('strictly rejects malformed optional rows while accepting empty authorized lists', async () => {
    // Given: strict schemas can be selected independently
    const makeFetcher = (malformedEndpoint?: string): typeof fetch => async (input) => {
      const endpoint = new URL(String(input)).pathname
      if (endpoint === ENDPOINT.Models) return Response.json({ data: [{ id: 'gateway/model-a' }] })
      if (endpoint === ENDPOINT.McpServers) return Response.json([])
      if (endpoint === ENDPOINT.SearchTools) {
        return malformedEndpoint === endpoint
          ? Response.json({ search_tools: [{ search_tool_name: 'search' }] })
          : Response.json({ search_tools: [] })
      }
      if (endpoint === ENDPOINT.Toolsets) {
        return malformedEndpoint === endpoint
          ? Response.json([{ toolset_id: 'missing-name' }])
          : Response.json([])
      }
      return new Response(null, { status: 404 })
    }

    // When: valid empty lists represent a key with no grants
    const empty = await discoverGatewayTools({ origin: ORIGIN, apiKey: API_KEY, fetcher: makeFetcher() })

    // Then: empty grants are not errors, but malformed rows are structured warnings
    expect(empty.searchToolNames).toEqual([])
    expect(empty.toolsets).toEqual([])
    expect(empty.warnings).toEqual([])
    for (const endpoint of [ENDPOINT.SearchTools, ENDPOINT.Toolsets]) {
      const result = await discoverGatewayTools({
        origin: ORIGIN,
        apiKey: API_KEY,
        fetcher: makeFetcher(endpoint),
      })
      expect(result.warnings).toContainEqual({
        resource: endpoint === ENDPOINT.SearchTools
          ? GATEWAY_DISCOVERY_RESOURCE.SearchTools
          : GATEWAY_DISCOVERY_RESOURCE.Toolsets,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
        endpoint,
      })
    }
  })

  test('bounds all four requests with shared and per-request timeouts', async () => {
    // Given: models return but all optional requests ignore cancellation and never settle
    const signals: AbortSignal[] = []
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.signal !== undefined) signals.push(init.signal)
      if (new URL(String(input)).pathname === ENDPOINT.Models) {
        return Response.json({ data: [{ id: 'gateway/model-a' }] })
      }
      return await new Promise<Response>(() => undefined)
    }

    // When: short test-only timeout bounds expire
    const startedAt = Date.now()
    const result = await discoverGatewayTools({
      origin: ORIGIN,
      apiKey: API_KEY,
      timeoutMs: 40,
      requestTimeoutMs: 10,
      fetcher,
    })

    // Then: onboarding completes promptly and reports every optional timeout
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(signals).toHaveLength(4)
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(3)
    expect(result.models).toEqual([{ id: 'gateway/model-a' }])
    expect(result.warnings.map(({ resource, kind }) => ({ resource, kind }))).toEqual([
      {
        resource: GATEWAY_DISCOVERY_RESOURCE.McpServers,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
      },
      {
        resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
      },
      {
        resource: GATEWAY_DISCOVERY_RESOURCE.Toolsets,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
      },
    ])
  })
})
