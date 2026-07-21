import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ENV,
  configured,
  createGatewayServer,
  expectAuthorization,
  plugin,
  ROUTE,
  runSearch,
  setAmbientKeys,
  setupIdentityTest,
  teardownIdentityTest,
} from './plugin-identity-test-support'

beforeEach(() => {
  setupIdentityTest()
})

afterEach(async () => {
  await teardownIdentityTest()
})

describe('LiteLLM configured provider identity', () => {
  test('does not treat custom Authorization as a provider identity', async () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = []
    const server = await createGatewayServer((url, authorization) => {
      requests.push({ url, authorization })
    }, true)
    const config = configured(server.baseURL, undefined, {
      Authorization: 'Bearer custom-only',
      'CF-Access-Client-Id': 'cf-client-id',
    })
    const hooks = await plugin()

    await hooks.config?.(config)

    await expect(runSearch(hooks)).rejects.toThrow('API key')
    expect(config.provider?.litellm?.models).toEqual({})
    expect(config.mcp).toBeUndefined()
    expect(requests).toEqual([
      { url: ROUTE.models, authorization: undefined },
      { url: '/v1/models', authorization: undefined },
    ])
  })

  test('uses the configured environment identity for every discovery surface', async () => {
    process.env[ENV.configured] = 'configured-key'
    setAmbientKeys()
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => {
      authorizationByRoute.set(url, authorization)
    })
    const config = configured(server.baseURL, `{env:${ENV.configured}}`, {
      'CF-Access-Client-Id': 'cf-client-id',
      authorization: 'Bearer custom-header',
      Authorization: 'Bearer mixed-case-header',
      'content-type': 'text/plain',
    })
    const hooks = await plugin(['research core'])

    await hooks.config?.(config)
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'configured-key')
    expect(config.provider?.litellm?.options?.apiKey).toBe('configured-key')
    expect(config.mcp?.['litellm-zread']?.headers).toEqual({
      'CF-Access-Client-Id': 'cf-client-id',
      Authorization: 'Bearer configured-key',
    })
    expect(config.mcp?.['litellm-toolset-research-core']?.headers).toEqual({
      'CF-Access-Client-Id': 'cf-client-id',
      Authorization: 'Bearer configured-key',
    })
  })
})
