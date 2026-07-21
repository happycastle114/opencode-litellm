import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  discoverGatewayTools,
} from '../src/cli/gateway-tool-discovery'
import { API_KEY, ENDPOINT, ORIGIN } from './gateway-tool-discovery-test-support'

describe('LiteLLM gateway tool discovery timeouts', () => {
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
    expect(signals).toHaveLength(5)
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(4)
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
