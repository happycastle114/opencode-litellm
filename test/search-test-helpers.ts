import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { LiteLLMPlugin } from '../src/index'

export const SEARCH_RESULTS = [
  {
    title: 'LiteLLM Search',
    url: 'https://docs.litellm.ai/docs/search',
    snippet: 'Search documentation',
    date: null,
    last_updated: null,
  },
]

export const SEARCH_TOOL = {
  toolName: 'search',
  searchToolName: 'agy-search',
}

export type CapturedRequest = {
  readonly url: string | undefined
  readonly authorization: string | undefined
  readonly contentType: string | undefined
  readonly cfAccessClientId: string | undefined
  readonly body: unknown
}

export type MetadataUpdate = {
  readonly title?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

export function clearKeys(): void {
  delete process.env.OPENCODE_LITELLM_API_KEY
  delete process.env.LITELLM_API_KEY
  delete process.env.LITELLM_MASTER_KEY
}

export async function configuredPlugin(
  baseURL: string,
  searchTool: Readonly<Record<string, unknown>>,
  providerOptions: Readonly<Record<string, unknown>> = {},
) {
  const hooks = await LiteLLMPlugin({}, { searchTools: [searchTool] })
  await hooks.config?.({
    provider: {
      litellm: {
        options: { ...providerOptions, baseURL: `${baseURL}/v1` },
        models: {},
      },
    },
  })
  return hooks
}

export function createContext(
  metadata: MetadataUpdate[],
  abort = new AbortController().signal,
) {
  return {
    abort,
    metadata(update: MetadataUpdate) {
      metadata.push(update)
    },
  }
}

export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind')
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function sendModels(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      object: 'list',
      data: [{ id: 'test-model', object: 'model' }],
    }),
  )
}

export async function captureSearch(
  request: IncomingMessage,
  response: ServerResponse,
  requests: CapturedRequest[],
): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  requests.push({
    url: request.url,
    authorization: request.headers.authorization,
    contentType: request.headers['content-type'],
    cfAccessClientId: request.headers['cf-access-client-id'],
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
  })
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ object: 'search', results: SEARCH_RESULTS }))
}
