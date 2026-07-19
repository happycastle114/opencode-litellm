import { afterEach, describe, expect, test } from 'bun:test'
import type { ServerResponse } from 'node:http'
import { discoverLiteLLMModels } from '../src/utils/litellm-api'
import { startServer } from './search-test-helpers'

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('LiteLLM model discovery', () => {
  test('maps the official model-group response before consulting v1 models', async () => {
    // Given: model-group discovery returns capability and provider metadata
    const requests: string[] = []
    const server = await startServer((request, response) => {
      requests.push(request.url ?? '')
      sendJson(response, {
        data: [
          {
            model_group: 'claude-sonnet',
            mode: 'chat',
            max_input_tokens: 200000,
            max_output_tokens: 8192,
            supports_function_calling: true,
            supports_vision: true,
            litellm_provider: 'anthropic',
          },
        ],
      })
    })
    servers.push(server)

    // When: models are discovered
    const models = await discoverLiteLLMModels(server.baseURL)

    // Then: the model group is mapped to the existing model contract
    expect(requests).toEqual(['/model_group/info'])
    expect(models).toEqual([
      {
        id: 'claude-sonnet',
        object: 'model',
        mode: 'chat',
        max_input_tokens: 200000,
        max_output_tokens: 8192,
        supports_function_calling: true,
        supports_vision: true,
        litellm_provider: 'anthropic',
      },
    ])
  })

  test('falls back to v1 models when model-group access is forbidden', async () => {
    // Given: the access-filtered key cannot read model-group metadata
    const requests: string[] = []
    const server = await startServer((request, response) => {
      requests.push(request.url ?? '')
      if (request.url === '/model_group/info') {
        response.writeHead(403)
        response.end()
        return
      }
      sendModels(response)
    })
    servers.push(server)

    // When: models are discovered
    const models = await discoverLiteLLMModels(server.baseURL)

    // Then: the OpenAI-compatible fallback supplies the models
    expect(requests).toEqual(['/model_group/info', '/v1/models'])
    expect(models.map((model) => model.id)).toEqual(['fallback-model'])
  })

  test.each([
    ['malformed', { data: 'not-an-array' }],
    ['empty', { data: [{ model_group: '' }, { mode: 'chat' }] }],
  ])('falls back when the model-group response is %s', async (_label, primary) => {
    // Given: the primary endpoint returns no valid model groups
    const requests: string[] = []
    const server = await startServer((request, response) => {
      requests.push(request.url ?? '')
      if (request.url === '/model_group/info') {
        sendJson(response, primary)
        return
      }
      sendModels(response)
    })
    servers.push(server)

    // When: models are discovered
    const models = await discoverLiteLLMModels(server.baseURL)

    // Then: discovery uses the fallback endpoint
    expect(requests).toEqual(['/model_group/info', '/v1/models'])
    expect(models.map((model) => model.id)).toEqual(['fallback-model'])
  })
})

function sendModels(response: ServerResponse): void {
  sendJson(response, {
    object: 'list',
    data: [{ id: 'fallback-model', object: 'model' }],
  })
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
