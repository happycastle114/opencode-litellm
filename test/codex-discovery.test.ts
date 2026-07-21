import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  CodexDiscoveryError,
  discoverCodexGatewayResources,
  readBundledCodexCatalog,
  type CodexSpawnBoundary,
} from '../src/cli/codex-discovery'

const ENDPOINT = {
  Models: '/v1/models',
  McpServers: '/v1/mcp/server',
} as const

const ORIGIN = 'https://gateway.example.test'
const API_KEY = 'proxy-key-for-test'
const BUNDLED_CATALOG_FIXTURE = readFileSync(
  new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
  'utf8',
)

describe('Codex gateway discovery', () => {
  test('rejects an empty API key before making discovery requests', async () => {
    // Given: no credential is available
    let requests = 0
    const fetcher: typeof fetch = async () => {
      requests += 1
      return Response.json({ data: [{ id: 'unexpected' }] })
    }

    // When/Then: discovery fails without contacting the gateway
    await expect(
      discoverCodexGatewayResources({ origin: ORIGIN, apiKey: '  ', fetcher }),
    ).rejects.toThrow(/api key/i)
    expect(requests).toBe(0)
  })

  test('concurrently authenticates both endpoints and deduplicates valid values', async () => {
    // Given: both discovery endpoints return overlapping, valid entries
    const started: string[] = []
    const resolvers: Array<() => void> = []
    const fetcher: typeof fetch = async (input, init) => {
      const endpoint = new URL(String(input)).pathname
      started.push(endpoint)
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      if (endpoint === ENDPOINT.Models) {
        return Response.json({
          data: [
            { id: 'gateway/model-a', object: 'model' },
            { id: 'gateway/model-a', object: 'model' },
            { id: '' },
            null,
            { id: 'gateway/model-b' },
          ],
        })
      }
      return Response.json([
        { server_name: 'research_docs' },
        { server_name: 'research_docs' },
        { server_name: 'bad name' },
        null,
        { server_name: 'zread' },
      ])
    }

    // When: discovery begins
    const pending = discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher })
    await Promise.resolve()
    expect(started).toEqual(expect.arrayContaining([ENDPOINT.Models, ENDPOINT.McpServers]))
    expect(started).toHaveLength(2)
    resolvers.forEach((resolve) => resolve())
    const result = await pending

    // Then: valid values survive in first-seen order with no duplicates
    expect(result.models).toEqual([
      { id: 'gateway/model-a', object: 'model' },
      { id: 'gateway/model-b' },
    ])
    expect(result.mcpServerNames).toEqual(['research_docs', 'zread'])
    expect(result.warnings).toEqual([])
  })

  test('retains explicit modality metadata for downstream picker filtering', async () => {
    const fetcher: typeof fetch = async (input) => {
      const endpoint = new URL(String(input)).pathname
      return endpoint === ENDPOINT.Models
        ? Response.json({
            data: [
              { id: 'chat-route', mode: 'chat' },
              { id: 'embedding-route', type: 'embedding', input_modalities: ['text'] },
            ],
          })
        : Response.json([])
    }

    const result = await discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher })

    expect(result.models).toEqual([
      { id: 'chat-route', mode: 'chat' },
      { id: 'embedding-route', type: 'embedding', input_modalities: ['text'] },
    ])
  })

  test('fails when model discovery is unavailable or malformed', async () => {
    // Given: a model endpoint failure and a successful MCP response
    const fetcher: typeof fetch = async (input) => {
      const endpoint = new URL(String(input)).pathname
      if (endpoint === ENDPOINT.Models) return new Response('nope', { status: 503 })
      return Response.json([{ server_name: 'zread' }])
    }

    // When/Then: model failure is fatal without exposing the API key
    await expect(
      discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher }),
    ).rejects.toThrow(/model discovery/i)
    await expect(
      discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher }),
    ).rejects.toThrow(new RegExp(`^(?!.*${API_KEY}).*$`))
  })

  test('preserves an HTTP status for typed authentication recovery', async () => {
    const error = await discoverCodexGatewayResources({
      origin: ORIGIN,
      apiKey: API_KEY,
      fetcher: async (input) => new URL(String(input)).pathname === ENDPOINT.Models
        ? new Response(null, { status: 401 })
        : Response.json([]),
    }).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(CodexDiscoveryError)
    expect(error).toMatchObject({ status: 401 })
    expect(String(error)).not.toContain(API_KEY)
  })

  test.each([
    ['malformed JSON', async () => new Response('{', { status: 200 })],
    ['wrong shape', async () => Response.json({ data: 'not-an-array' })],
    ['empty data', async () => Response.json({ data: [] })],
  ])('treats model %s as fatal', async (_label, modelResponse) => {
    // Given: a malformed or empty model catalog
    const fetcher: typeof fetch = async (input) => {
      const endpoint = new URL(String(input)).pathname
      return endpoint === ENDPOINT.Models
        ? modelResponse()
        : Response.json([{ server_name: 'zread' }])
    }

    // When/Then: discovery rejects the invalid model catalog
    await expect(
      discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher }),
    ).rejects.toThrow(/model discovery/i)
  })

  test('degrades MCP failures to an empty list and a warning', async () => {
    // Given: valid models and an unavailable MCP endpoint
    const fetcher: typeof fetch = async (input) => {
      const endpoint = new URL(String(input)).pathname
      return endpoint === ENDPOINT.Models
        ? Response.json({ data: [{ id: 'gateway/model-a' }] })
        : new Response('unavailable', { status: 502 })
    }

    // When: discovery runs
    const result = await discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher })

    // Then: models remain usable and MCP failure is observable without being fatal
    expect(result.models).toEqual([{ id: 'gateway/model-a' }])
    expect(result.mcpServerNames).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/mcp/i)
    expect(result.warnings.join(' ')).not.toContain(API_KEY)
  })

  test('treats a structurally invalid MCP catalog as a warning-only failure', async () => {
    // Given: valid models and a MCP wrapper whose rows contain no valid names
    const fetcher: typeof fetch = async (input) => {
      const endpoint = new URL(String(input)).pathname
      return endpoint === ENDPOINT.Models
        ? Response.json({ data: [{ id: 'gateway/model-a' }] })
        : Response.json({ data: [{ server_name: 'not a valid name' }] })
    }

    // When: discovery runs
    const result = await discoverCodexGatewayResources({ origin: ORIGIN, apiKey: API_KEY, fetcher })

    // Then: malformed MCP rows cannot make model discovery fail
    expect(result.models).toEqual([{ id: 'gateway/model-a' }])
    expect(result.mcpServerNames).toEqual([])
    expect(result.warnings[0]).toMatch(/invalid|mcp/i)
  })

  test('uses a shared bounded timeout plus a per-request timeout', async () => {
    // Given: both requests never settle and a short test timeout
    const signals: AbortSignal[] = []
    const fetcher: typeof fetch = async (_input, init) => {
      if (init?.signal !== undefined) signals.push(init.signal)
      return await new Promise<Response>(() => undefined)
    }

    // When: the configured bounds expire
    const startedAt = Date.now()
    const pending = discoverCodexGatewayResources({
      origin: ORIGIN,
      apiKey: API_KEY,
      timeoutMs: 40,
      requestTimeoutMs: 10,
      fetcher,
    })

    // Then: both requests are aborted and the model failure is bounded
    await expect(pending).rejects.toThrow(/model discovery/i)
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})

describe('Bundled Codex catalog discovery', () => {
  test('selects the lowest-priority visible model as the inherited prompt template', () => {
    // Given: the Codex CLI emits the 0.144.1-shaped fixture and a warning on stderr
    const boundary: CodexSpawnBoundary = {
      spawn: () => ({
        status: 0,
        stdout: BUNDLED_CATALOG_FIXTURE,
        stderr: 'WARNING: local aliases unavailable\n',
      }),
    }

    // When: the bundled catalog is read
    const result = readBundledCodexCatalog(boundary)
    const source = JSON.parse(BUNDLED_CATALOG_FIXTURE)

    // Then: bytes are normalized and the first Codex-sorted visible row supplies prompt behavior
    expect(result.json).toBe(`${JSON.stringify(source, null, 2)}\n`)
    expect(result.defaultModel).toBe(source.models[0].slug)
    expect(result.template.base_instructions).toBe(source.models[0].base_instructions)
    expect(result.template.model_messages).toEqual(source.models[0].model_messages)
    expect(result.template.comp_hash).toBe(source.models[0].comp_hash)
  })

  test('rejects missing Codex and invalid or empty stdout without leaking details', () => {
    // Given: process boundaries for missing and invalid Codex output
    const missing: CodexSpawnBoundary = {
      spawn: () => { throw new Error('ENOENT /secret/codex-token') },
    }
    const invalid: CodexSpawnBoundary = {
      spawn: () => ({ status: 0, stdout: '{"models":[]}', stderr: '' }),
    }

    // When/Then: both errors are clear and secret-free
    expect(() => readBundledCodexCatalog(missing)).toThrow(/codex.*not found/i)
    expect(() => readBundledCodexCatalog(missing)).toThrow(new RegExp('^(?!.*codex-token).*$'))
    expect(() => readBundledCodexCatalog(invalid)).toThrow(/catalog|models/i)
  })

  test('rejects non-warning stderr and non-zero process status', () => {
    // Given: a process that reports an execution failure alongside JSON
    const boundary: CodexSpawnBoundary = {
      spawn: () => ({ status: 1, stdout: '{"models":[{"slug":"gpt-test"}]}', stderr: 'fatal' }),
    }

    // When/Then: process failure is not mistaken for a valid catalog
    expect(() => readBundledCodexCatalog(boundary)).toThrow(/codex.*(failed|exit)/i)
  })

  test.each([
    ['missing base instructions', {
      slug: 'invalid-template',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      model_messages: { instructions_template: 'template' },
    }],
    ['missing model message template', {
      slug: 'invalid-template',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      base_instructions: 'base',
      model_messages: null,
    }],
  ])('rejects a selected prompt template with %s', (_label, model) => {
    const boundary: CodexSpawnBoundary = {
      spawn: () => ({
        status: 0,
        stdout: JSON.stringify({ models: [model] }),
        stderr: '',
      }),
    }

    expect(() => readBundledCodexCatalog(boundary)).toThrow(/template|catalog/i)
  })
})
