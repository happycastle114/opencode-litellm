import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ENV,
  configured,
  createGatewayServer,
  expectAuthorization,
  plugin,
  runSearch,
  setAmbientKeys,
  setupIdentityTest,
  teardownIdentityTest,
  writeOfficialToken,
} from './plugin-identity-test-support'

beforeEach(() => {
  setupIdentityTest()
})

afterEach(async () => {
  await teardownIdentityTest()
})

describe('LiteLLM official provider identity', () => {
  test('uses the exact-origin official token when the configured placeholder is unresolved', async () => {
    setAmbientKeys()
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => {
      authorizationByRoute.set(url, authorization)
    })
    writeOfficialToken(server.baseURL)
    const config = configured(server.baseURL, `{env:${ENV.missing}}`)
    const hooks = await plugin()

    await hooks.config?.(config)
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'official-key')
    expect(config.provider?.litellm?.options?.apiKey).toBe('official-key')
  })

  test('uses the exact-origin official token after OpenCode substitutes an empty key', async () => {
    setAmbientKeys()
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => {
      authorizationByRoute.set(url, authorization)
    })
    writeOfficialToken(server.baseURL)
    const config = configured(server.baseURL, '')
    const hooks = await plugin()

    await hooks.config?.(config)
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'official-key')
    expect(config.provider?.litellm?.options?.apiKey).toBe('official-key')
  })

  test('rejects an unsafe official token without sending or injecting it', async () => {
    setAmbientKeys()
    const requests: string[] = []
    const server = await createGatewayServer((url) => requests.push(url))
    writeOfficialToken(server.baseURL, 'unsafe\r\nBearer injected')
    const config = configured(server.baseURL, '')
    const hooks = await plugin()

    await hooks.config?.(config)

    await expect(runSearch(hooks)).rejects.toThrow('base URL')
    expect(requests).toEqual([])
    expect(config.provider?.litellm?.options?.apiKey).toBe('')
    expect(JSON.stringify(config)).not.toContain('unsafe')
  })
})
