import { createServer } from 'node:http'
import { once } from 'node:events'
import { timingSafeEqual } from 'node:crypto'
import { HYBRID_MAX_BODY, hybridError, routeHybrid } from './codex-hybrid-protocol'

export async function startHybridProxy(options: {
  readonly gatewayOrigin: string
  readonly apiKey: string
  readonly nativeOrigin?: string
}): Promise<{ readonly baseUrl: string; readonly close: () => Promise<void> }> {
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController()
    outgoing.once('close', () => controller.abort())
    try {
      const key = incoming.headers['x-litellm-api-key']
      const expected = Buffer.from(options.apiKey)
      const actual = Buffer.from(typeof key === 'string' ? key.replace(/^Bearer /, '') : '')
      let response: Response
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        response = hybridError(401, 'Local hybrid proxy authentication failed.')
      } else if (incoming.method !== 'POST' || incoming.url !== '/codex-hybrid/responses') {
        response = hybridError(404, 'Unknown hybrid endpoint.')
      } else {
        const parts: Buffer[] = []
        let size = 0
        for await (const part of incoming) {
          const bytes = Buffer.from(part)
          size += bytes.length
          if (size > HYBRID_MAX_BODY) {
            outgoing.writeHead(413).end('Request exceeds the hybrid body limit.')
            return
          }
          parts.push(bytes)
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string') headers.set(name, value)
        }
        const request = new Request('http://127.0.0.1/codex-hybrid/responses', {
          method: 'POST', headers, body: Buffer.concat(parts), signal: controller.signal,
        })
        response = await routeHybrid(request, options.gatewayOrigin, options.nativeOrigin ?? 'https://chatgpt.com/backend-api/codex')
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body !== null) {
        const reader = response.body.getReader()
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            if (!outgoing.write(part.value)) await once(outgoing, 'drain', { signal: controller.signal })
          }
        } finally { await reader.cancel() }
      }
      outgoing.end()
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(502).end('Hybrid upstream connection failed.')
      else outgoing.destroy()
    }
  })
  server.requestTimeout = 30_000
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Local hybrid listener did not bind.')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/codex-hybrid`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}
