import { describe, expect, test } from 'bun:test'
import type { Hooks } from '@opencode-ai/plugin'
import { LiteLLMPlugin } from '../src/index'
import { version } from '../src/version'
import {
  createContext,
  sendModels,
  startServer,
  restoreEnv,
  type MetadataUpdate,
} from './search-test-helpers'

describe('native LiteLLM web search tool', () => {
  test('uses the active LiteLLM model and native Responses web_search tool', async () => {
    const originalApiKey = process.env.OPENCODE_LITELLM_API_KEY
    process.env.OPENCODE_LITELLM_API_KEY = 'native-search-key'
    const requests: Array<{
      authorization: string | undefined
      body: unknown
      url: string | undefined
      userAgent: string | undefined
    }> = []
    const server = await startServer(async (request, response) => {
      if (request.method === 'GET') return sendModels(response)
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        url: request.url,
        userAgent: request.headers['user-agent'],
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'Official result',
            annotations: [
              {
                type: 'url_citation',
                title: 'LiteLLM web search interception',
                url: 'https://docs.litellm.ai/docs/integrations/websearch_interception',
              },
              {
                type: 'url_citation',
                title: 'Duplicate citation',
                url: 'https://docs.litellm.ai/docs/integrations/websearch_interception',
              },
            ],
          }],
        }],
        output_text: null,
      }))
    })

    try {
      const hooks = await LiteLLMPlugin({}) as Hooks
      await hooks.config?.({
        provider: {
          litellm: {
            options: { baseURL: `${server.baseURL}/v1` },
            models: {},
          },
        },
      })
      await hooks['chat.message']?.(
        {
          sessionID: 'session-1',
          model: { providerID: 'litellm', modelID: 'gpt-5.4-chatgpt' },
        },
        { message: {} as never, parts: [] },
      )
      const metadata: MetadataUpdate[] = []

      const result = await hooks.tool?.['web-search']?.execute(
        { query: 'LiteLLM websearch interception official docs' },
        createContext(metadata),
      )

      expect(requests).toEqual([{
        authorization: 'Bearer native-search-key',
        body: {
          input: 'Perform a web search for the query: LiteLLM websearch interception official docs',
          instructions: 'You are an assistant for performing a web search tool use',
          max_output_tokens: 16000,
          model: 'gpt-5.4-chatgpt',
          tools: [{ type: 'web_search' }],
        },
        url: '/v1/responses',
        userAgent: `opencode-litellm/${version}`,
      }])
      expect(metadata).toEqual([{
        title: 'Web search: LiteLLM websearch interception official docs',
        metadata: { resultCount: 2 },
      }])
      expect(result).toEqual({
        output: JSON.stringify({
          query: 'LiteLLM websearch interception official docs',
          results: [
            'Official result',
            [{
              title: 'LiteLLM web search interception',
              url: 'https://docs.litellm.ai/docs/integrations/websearch_interception',
            }],
          ],
        }, null, 2),
        metadata: { resultCount: 2 },
      })
    } finally {
      restoreEnv('OPENCODE_LITELLM_API_KEY', originalApiKey)
      await server.close()
    }
  })

  test('retains an active model when a message omits model and clears lifecycle state', async () => {
    const originalApiKey = process.env.OPENCODE_LITELLM_API_KEY
    process.env.OPENCODE_LITELLM_API_KEY = 'lifecycle-key'
    let responseRequests = 0
    const server = await startServer((_request, response) => {
      if (_request.method === 'GET') return sendModels(response)
      responseRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ output_text: 'Search succeeded', output: [] }))
    })

    try {
      const hooks = await LiteLLMPlugin({}) as Hooks
      await hooks.config?.({
        provider: {
          litellm: {
            options: { baseURL: `${server.baseURL}/v1` },
            models: {},
          },
        },
      })
      const tool = hooks.tool?.['web-search']

      const setActiveModel = () => hooks['chat.message']?.(
        {
          sessionID: 'session-lifecycle',
          model: { providerID: 'litellm', modelID: 'selected-model' },
        },
        { message: {} as never, parts: [] },
      )
      const execute = () => tool?.execute(
        { query: 'current LiteLLM docs' },
        createContext([], undefined, 'session-lifecycle'),
      )

      await setActiveModel()
      await hooks['chat.message']?.(
        { sessionID: 'session-lifecycle' },
        { message: {} as never, parts: [] },
      )
      await expect(execute()).resolves.toEqual({
        output: JSON.stringify({
          query: 'current LiteLLM docs',
          results: ['Search succeeded'],
        }, null, 2),
        metadata: { resultCount: 1 },
      })
      expect(responseRequests).toBe(1)

      await hooks.event?.({
        event: {
          type: 'session.deleted',
          properties: { info: { id: 'session-lifecycle' } as never },
        },
      })
      await expect(execute()).rejects.toThrow('No active LiteLLM model')

      await setActiveModel()
      await hooks['chat.message']?.(
        {
          sessionID: 'session-lifecycle',
          model: { providerID: 'openai', modelID: 'other-model' },
        },
        { message: {} as never, parts: [] },
      )
      await expect(execute()).rejects.toThrow('No active LiteLLM model')

      await setActiveModel()
      await hooks.dispose?.()
      await expect(execute()).rejects.toThrow('No active LiteLLM model')
    } finally {
      restoreEnv('OPENCODE_LITELLM_API_KEY', originalApiKey)
      await server.close()
    }
  })
})
