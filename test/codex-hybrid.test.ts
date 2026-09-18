import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { startHybridProxy } from '../src/cli/codex-hybrid-proxy'
import { launchHybridClient } from '../src/cli/codex-hybrid-launch'
import { installPreparedClients } from '../src/cli/client-installer'
import { inspectCodexConfig } from '../src/cli/doctor'
import { CodexMode } from '../src/cli/install-intent'
import { buildHybridCatalog } from '../src/cli/codex-hybrid-catalog'
import { BUNDLED_CATALOG, createHomeDirectory, preparedInstall } from './client-installer-test-support'

type Observed = { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }
let upstream: Server
let origin: string
let proxy: Awaited<ReturnType<typeof startHybridProxy>>
let observed: Observed[]
let nativeStatus: number
let nativeBody: string
let admissionStatus: number
let paidStatus: number

beforeEach(async () => {
  observed = []
  nativeStatus = 200
  nativeBody = 'data: {"type":"response.completed"}\n\n'
  admissionStatus = 200
  paidStatus = 200
  upstream = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    observed.push({ path: request.url ?? '', headers: request.headers, body: parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {} })
    if (request.url === '/v1/models') {
      response.writeHead(admissionStatus, { 'content-type': 'application/json' }).end('{"data":[{"id":"paid"}]}')
    } else if (request.url === '/native/responses') {
      response.writeHead(nativeStatus, { 'content-type': nativeStatus === 200 ? 'text/event-stream' : 'application/json' }).end(nativeBody)
    } else {
      response.writeHead(paidStatus, { 'content-type': 'application/json' }).end('{"id":"paid-response"}')
    }
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address')
  origin = `http://127.0.0.1:${address.port}`
  proxy = await startHybridProxy({ gatewayOrigin: origin, nativeOrigin: `${origin}/native`, apiKey: 'gateway-test' })
})

afterEach(async () => {
  await proxy.close()
  upstream.closeAllConnections()
  await new Promise<void>((resolve) => upstream.close(() => resolve()))
})

async function call(model = 'auto/native', extra: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${proxy.baseUrl}/responses`, {
    method: 'POST', headers: {
      authorization: 'Bearer native-test', 'chatgpt-account-id': 'account-test',
      'x-litellm-api-key': 'gateway-test', 'x-codex-fallback-model': 'paid',
      cookie: 'must-not-forward', 'content-type': 'application/json',
    }, body: JSON.stringify({ model, input: [{ role: 'user', content: 'hello' }], ...extra }),
  })
}

function exhaust(code = 'usage_limit_reached'): void {
  nativeStatus = 429
  nativeBody = JSON.stringify({ error: { type: code } })
}

test('subscription succeeds without paid inference; credentials stay on their own upstream', async () => {
  const response = await call()
  expect(response.headers.get('x-codex-route')).toBe('subscription')
  expect(await response.text()).toBe(nativeBody)
  expect(observed.map((request) => request.path)).toEqual(['/v1/models', '/native/responses'])
  expect(observed[1]?.headers.authorization).toBe('Bearer native-test')
  expect(observed[1]?.headers['x-litellm-api-key']).toBeUndefined()
  expect(observed[1]?.headers.cookie).toBeUndefined()
})

test('quota fallback preserves tool history and uses only the gateway credential', async () => {
  exhaust()
  const response = await call('auto/native', { input: [
    { type: 'reasoning', encrypted_content: 'opaque' },
    { type: 'function_call', id: 'backend-id', call_id: 'call-1', name: 'shell', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-1', output: 'done' },
  ] })
  expect(await response.json()).toEqual({ id: 'paid-response' })
  expect(response.headers.get('x-codex-route')).toBe('litellm')
  const paid = observed.at(-1)
  expect(paid?.headers.authorization).toBe('Bearer gateway-test')
  expect(paid?.headers['chatgpt-account-id']).toBeUndefined()
  expect(paid?.headers.cookie).toBeUndefined()
  expect(paid?.body).toMatchObject({ model: 'paid', input: [
    { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-1', output: 'done' },
  ] })
})

test('rate limits and auth failures do not spend paid tokens', async () => {
  for (const status of [401, 403, 429, 500]) {
    observed = []
    exhaust('rate_limit_exceeded')
    nativeStatus = status
    const response = await call()
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: { type: 'rate_limit_exceeded' } })
    expect(observed).toHaveLength(2)
  }
})

test('pre-output SSE quota switches; a tool event commits the route even in the same chunk', async () => {
  const quota = 'data: {"type":"error","code":"usage_limit_reached"}\n\n'
  nativeBody = 'data: {"type":"response.created"}\n\n' + quota
  expect((await call()).headers.get('x-codex-route')).toBe('litellm')
  observed = []
  nativeBody = 'data: {"type":"response.output_item.added","item":{"type":"function_call"}}\n\n' + quota
  const response = await call()
  expect(await response.text()).toBe(nativeBody)
  expect(observed).toHaveLength(2)
})

test('explicit routes, gateway denial, and subscription reset retain their meanings', async () => {
  exhaust()
  expect((await call('subscription/native')).status).toBe(429)
  expect(observed).toHaveLength(2)
  observed = []
  expect((await call('litellm/paid')).headers.get('x-codex-route')).toBe('litellm')
  expect(observed).toHaveLength(2)
  admissionStatus = 401
  expect((await call()).status).toBe(401)
  admissionStatus = 200
  paidStatus = 403
  expect((await call()).status).toBe(403)
  nativeStatus = 200
  nativeBody = 'data: {"type":"response.completed"}\n\n'
  expect((await call()).headers.get('x-codex-route')).toBe('subscription')
})

test('local authentication and opaque history are rejected before inference', async () => {
  expect((await fetch(`${proxy.baseUrl}/responses`, { method: 'POST' })).status).toBe(401)
  for (const extra of [{ previous_response_id: 'resp-1' }, { input: [{ type: 'compaction', encrypted_content: 'opaque' }] }]) {
    expect((await call('auto/native', extra)).status).toBe(400)
  }
  expect(observed).toHaveLength(0)
})

test('both modes install one catalog and keep native authentication without storing credentials', async () => {
  const home = createHomeDirectory()
  try {
    for (const mode of [CodexMode.HybridServer, CodexMode.HybridClient]) {
      const path = join(home, '.codex', 'config.toml')
      await installPreparedClients(preparedInstall({ codexConfig: path, codexMode: mode, codexFallbackModel: 'gateway-model' }), {
        env: { HOME: home }, now: () => new Date(0), bundledCodexCatalog: () => BUNDLED_CATALOG,
      })
      const source = readFileSync(path, 'utf8')
      const config = parseToml(source)
      expect(config.forced_login_method).toBe('chatgpt')
      expect(source).toContain('requires_openai_auth = true')
      expect(source).toContain(mode === CodexMode.HybridServer ? 'https://litellm.example.test/codex-hybrid' : 'http://127.0.0.1:0/codex-hybrid')
      expect(source).not.toContain('sk-installer-secret')
      expect(inspectCodexConfig(path).status).toBe('ok')
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('catalog namespaces collisions and requires an available explicit paid fallback', () => {
  const catalog = buildHybridCatalog([{ id: BUNDLED_CATALOG.defaultModel }], BUNDLED_CATALOG, BUNDLED_CATALOG.defaultModel)
  expect(catalog.json).toContain(`"auto/${BUNDLED_CATALOG.defaultModel}"`)
  expect(catalog.json).toContain(`"subscription/${BUNDLED_CATALOG.defaultModel}"`)
  expect(catalog.json).toContain(`"litellm/${BUNDLED_CATALOG.defaultModel}"`)
  expect(() => buildHybridCatalog([{ id: 'paid' }], BUNDLED_CATALOG, 'missing')).toThrow('available gateway chat model')
  const portable = JSON.parse(buildHybridCatalog([{ id: 'paid', max_input_tokens: 16_000, input_modalities: ['text'] }], BUNDLED_CATALOG, 'paid').json)
  expect(portable.models[0]).toMatchObject({ context_window: 16_000, input_modalities: ['text'], use_responses_lite: false })
  expect(portable.models[1].use_responses_lite).toBe(false)
})

test('client launcher keeps proxy alive during async child and closes it afterwards', async () => {
  let launchedUrl = ''
  const result = await launchHybridClient({ command: 'codex', args: ['exec', '--', 'test'], gatewayOrigin: origin, apiKey: 'gateway-test' }, {
    which: () => '/fixture/codex', spawn: () => { throw new Error('Sync launch would block the proxy') },
    spawnAsync: async (_file, args, options) => {
      expect(args.slice(0, 4)).toEqual(['-c', 'cli_auth_credentials_store="file"', '-c', 'mcp_oauth_credentials_store="file"'])
      expect(options.env.LITELLM_CLI_DISABLE_KEYRING).toBe('1')
      const override = args[5]
      if (override === undefined) throw new Error('Missing URL override')
      launchedUrl = JSON.parse(override.slice(override.indexOf('=') + 1))
      expect(args.slice(6)).toEqual(['exec', '--', 'test'])
      const response = await fetch(`${launchedUrl}/responses`, { method: 'POST', headers: { 'x-litellm-api-key': 'gateway-test' }, body: JSON.stringify({ model: 'litellm/paid', input: 'hello' }) })
      expect(await response.json()).toEqual({ id: 'paid-response' })
      return { status: 0, signal: null }
    },
  })
  expect(result.status).toBe(0)
  await expect(fetch(`${launchedUrl}/responses`)).rejects.toThrow()
})
