import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ENV,
  configured,
  createGatewayServer,
  plugin,
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

describe('LiteLLM plugin provider identity', () => {
  test('does not make discovery or search requests for an unresolved configured key', async () => {
    setAmbientKeys()
    const requests: string[] = []
    const server = await createGatewayServer((url) => requests.push(url))
    const config = configured(server.baseURL, `{env:${ENV.missing}}`)
    const hooks = await plugin()

    await hooks.config?.(config)

    await expect(runSearch(hooks)).rejects.toThrow('base URL')
    expect(requests).toEqual([])
    expect(config.provider?.litellm?.options?.apiKey).toBe(`{env:${ENV.missing}}`)
    expect(config.mcp).toBeUndefined()
  })

  test('treats an explicitly empty credential as unresolved', async () => {
    setAmbientKeys()
    const requests: string[] = []
    const server = await createGatewayServer((url) => requests.push(url))
    const config = configured(server.baseURL, '')
    const hooks = await plugin()

    await hooks.config?.(config)

    await expect(runSearch(hooks)).rejects.toThrow('base URL')
    expect(requests).toEqual([])
    expect(config.provider?.litellm?.options?.apiKey).toBe('')
    expect(config.mcp).toBeUndefined()
  })

  test('clears a previous search endpoint before an unresolved reconfiguration', async () => {
    process.env[ENV.configured] = 'configured-key'
    const firstRequests: string[] = []
    const secondRequests: string[] = []
    const firstServer = await createGatewayServer((url) => firstRequests.push(url))
    const secondServer = await createGatewayServer((url) => secondRequests.push(url))
    const hooks = await plugin()

    await hooks.config?.(configured(firstServer.baseURL, `{env:${ENV.configured}}`))
    await runSearch(hooks, 'first')
    const firstRequestCount = firstRequests.length

    await hooks.config?.(configured(secondServer.baseURL, ''))

    await expect(runSearch(hooks, 'second')).rejects.toThrow('base URL')
    expect(firstRequests).toHaveLength(firstRequestCount)
    expect(secondRequests).toEqual([])
  })
})
