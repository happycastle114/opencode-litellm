export const HYBRID_MAX_BODY = 16 * 1024 * 1024
const NATIVE_HEADERS = [
  'authorization', 'chatgpt-account-id', 'originator', 'user-agent', 'openai-beta',
  'session_id', 'x-codex-turn-state', 'x-codex-turn-metadata',
] as const

export function hybridError(status: number, message: string): Response {
  return Response.json({ error: { message, type: 'codex_hybrid_error' } }, { status })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function portableRequest(body: Record<string, unknown>, preserveServiceTier = false): Record<string, unknown> {
  if (body.previous_response_id) throw new Error('Hybrid routing requires full input, without previous_response_id.')
  const result = { ...body }
  if (Array.isArray(body.input)) {
    result.input = body.input.flatMap((item: unknown) => {
      if (!isRecord(item)) throw new Error('Hybrid input items must be objects.')
      if (item.type === 'compaction' || item.type === 'item_reference') {
        throw new Error('Opaque history cannot cross providers; start a new conversation.')
      }
      if (item.type === 'reasoning') return []
      const { id: _id, ...clean } = item
      return [clean]
    })
  }
  if (!preserveServiceTier) delete result.service_tier
  return result
}

export function quotaError(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (isRecord(value.error)) return value.error.code === 'usage_limit_reached' || value.error.type === 'usage_limit_reached'
  return value.type === 'error' && value.code === 'usage_limit_reached'
}

export async function routeHybrid(request: Request, gatewayOrigin: string, nativeOrigin: string): Promise<Response> {
  const key = (request.headers.get('x-litellm-api-key') ?? '').replace(/^Bearer /, '')
  if (!key || /\s/.test(key)) return hybridError(401, 'A LiteLLM gateway key is required.')
  let body: Record<string, unknown>
  let route: string
  const fallback = request.headers.get('x-codex-fallback-model') ?? ''
  try {
    const value: unknown = await request.json()
    if (!isRecord(value) || typeof value.model !== 'string') throw new Error('A model is required.')
    const separator = value.model.indexOf('/')
    route = value.model.slice(0, separator)
    const model = value.model.slice(separator + 1)
    if (separator < 0 || !model || !['auto', 'subscription', 'litellm'].includes(route)) {
      throw new Error('Use auto/<model>, subscription/<model>, or litellm/<model>.')
    }
    if (route === 'auto' && !fallback.trim()) throw new Error('An explicit x-codex-fallback-model is required for auto routing.')
    body = portableRequest({ ...value, model }, route === 'subscription')
  } catch (error) {
    return hybridError(400, error instanceof Error ? error.message : 'Invalid request.')
  }
  const nativeHeaders = new Headers({ 'content-type': 'application/json' })
  for (const name of NATIVE_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) nativeHeaders.set(name, value)
  }
  if (route !== 'litellm' && !nativeHeaders.get('authorization')?.startsWith('Bearer ')) {
    return hybridError(401, 'Codex ChatGPT login is required for subscription routing.')
  }
  const gatewayHeaders = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300_000)])
  try {
    const admission = await fetch(`${gatewayOrigin}/v1/models`, { headers: gatewayHeaders, redirect: 'manual', signal })
    await admission.body?.cancel()
    if (admission.status !== 200) return hybridError(admission.status, 'LiteLLM gateway admission failed.')
    let target = route === 'litellm' ? 'litellm' : 'subscription'
    let upstream = await fetch(target === 'litellm' ? `${gatewayOrigin}/v1/responses` : `${nativeOrigin}/responses`, {
      method: 'POST', headers: target === 'litellm' ? gatewayHeaders : nativeHeaders,
      body: JSON.stringify(body), redirect: 'manual', signal,
    })
    if (route === 'auto') {
      const inspected = await inspectSubscription(upstream)
      upstream = inspected.response
      if (inspected.exhausted) {
        target = 'litellm'
        upstream = await fetch(`${gatewayOrigin}/v1/responses`, {
          method: 'POST', headers: gatewayHeaders, body: JSON.stringify({ ...body, model: fallback }), redirect: 'manual', signal,
        })
      }
    }
    const headers = new Headers({ 'x-codex-route': target, 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    for (const [name, value] of upstream.headers) {
      if (['content-type', 'retry-after', 'x-request-id'].includes(name) || name.startsWith('x-codex-')) headers.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return hybridError(502, 'Hybrid upstream connection failed.')
  }
}

async function inspectSubscription(response: Response): Promise<{ exhausted: boolean; response: Response }> {
  if (response.status === 429) {
    const raw = await response.arrayBuffer()
    return { exhausted: quotaError(parseJson(new TextDecoder().decode(raw))), response: new Response(raw, response) }
  }
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || response.body === null) {
    return { exhausted: false, response }
  }
  const reader = response.body.getReader()
  const buffered: Uint8Array[] = []
  const decoder = new TextDecoder()
  let pending = ''
  let size = 0
  let inspect = true
  while (inspect && size < 64 * 1024) {
    const part = await reader.read()
    if (part.done) break
    buffered.push(part.value)
    size += part.value.length
    pending = (pending + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, '\n')
    let index: number
    while ((index = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, index)
      pending = pending.slice(index + 2)
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (!data) continue
      const event = parseJson(data)
      if (quotaError(event) || (isRecord(event) && event.type === 'response.failed' && quotaError(event.response))) {
        await reader.cancel()
        return { exhausted: true, response: new Response(null) }
      }
      if (!isRecord(event) || !['response.created', 'response.in_progress'].includes(String(event.type))) {
        inspect = false
        break
      }
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const bufferedPart = buffered.shift()
      if (bufferedPart !== undefined) { controller.enqueue(bufferedPart); return }
      const part = await reader.read()
      if (part.done) controller.close()
      else controller.enqueue(part.value)
    },
    cancel: () => reader.cancel(),
  })
  return { exhausted: false, response: new Response(stream, response) }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}
