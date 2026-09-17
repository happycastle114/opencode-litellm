import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { InstallAuth } from '../src/cli/install-intent'
import {
  ENV, configured, createGatewayServer, expectAuthorization, plugin, runSearch,
  setAmbientKeys, setupIdentityTest, teardownIdentityTest, writeManualApiKey,
  writeOfficialToken,
} from './plugin-identity-test-support'

let native: ReturnType<typeof setupIdentityTest>

beforeEach(() => { native = setupIdentityTest() })
afterEach(teardownIdentityTest)

describe('OpenCode desktop manual credential', () => {
  test.each([undefined, '', `{env:${ENV.missing}}`])(
    'authenticates direct config-hook discovery with a saved key and no ambient credentials (%s)',
    async (configuredKey) => {
      const authorizationByRoute = new Map<string, string | undefined>()
      const server = await createGatewayServer((url, authorization) => {
        authorizationByRoute.set(url, authorization)
      }, true)
      const path = writeManualApiKey(server.baseURL)
      const before = readFileSync(path, 'utf8')
      const config = configured(server.baseURL, configuredKey)
      const hooks = await plugin([], InstallAuth.Environment)

      await hooks.config?.(config)
      await runSearch(hooks)

      expectAuthorization(authorizationByRoute, 'manual-key')
      expect(config.provider?.litellm?.options?.apiKey).toBe('manual-key')
      expect(config.mcp?.['litellm-zread']?.headers?.Authorization).toBe('Bearer manual-key')
      expect(native).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(before)
      for (const name of [ENV.opencode, ENV.litellm, ENV.master, ENV.proxy]) {
        expect(process.env[name]).toBeUndefined()
      }
    },
  )

  test('prefers a matching manual key over native and ambient credentials', async () => {
    setAmbientKeys()
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => authorizationByRoute.set(url, authorization))
    writeManualApiKey(server.baseURL)
    writeOfficialToken(server.baseURL)
    const hooks = await plugin([], InstallAuth.Environment)

    await hooks.config?.(configured(server.baseURL, ''))
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'manual-key')
    expect(native).not.toHaveBeenCalled()
  })

  test('uses native exact-origin authentication when the manual store belongs to another gateway', async () => {
    setAmbientKeys()
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => authorizationByRoute.set(url, authorization))
    writeManualApiKey('https://unrelated.example.test', 'unrelated-manual-key')
    writeOfficialToken(server.baseURL)
    const hooks = await plugin([], InstallAuth.Sso)

    await hooks.config?.(configured(server.baseURL, ''))
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'official-key')
    expect(native).toHaveBeenCalledTimes(1)
  })

  test('does not use wrong-origin manual or native keys for an unresolved configured placeholder', async () => {
    setAmbientKeys()
    const requests: string[] = []
    const server = await createGatewayServer((url) => requests.push(url))
    writeManualApiKey('https://unrelated.example.test')
    writeOfficialToken('https://unrelated.example.test')
    const hooks = await plugin([], InstallAuth.Environment)
    const config = configured(server.baseURL, `{env:${ENV.missing}}`)

    await hooks.config?.(config)

    await expect(runSearch(hooks)).rejects.toThrow('base URL')
    expect(requests).toEqual([])
    expect(config.provider?.litellm?.options?.apiKey).toBe(`{env:${ENV.missing}}`)
    expect(native).not.toHaveBeenCalled()
  })

  test.each([InstallAuth.Environment, InstallAuth.Sso, undefined])('preserves a valid explicit key ahead of both stored credentials (%s)', async (auth) => {
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => authorizationByRoute.set(url, authorization))
    writeManualApiKey(server.baseURL)
    writeOfficialToken(server.baseURL)
    const hooks = await plugin([], auth)

    await hooks.config?.(configured(server.baseURL, 'explicit-key'))
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'explicit-key')
    expect(native).not.toHaveBeenCalled()
  })

  test.each([null, 17, ' ', 'unsafe\r\nBearer injected', '{invalid:reference}', `{env:${ENV.configured}}`])(
    'does not replace a malformed explicit credential with either stored key (%s)',
    async (apiKey) => {
      process.env[ENV.configured] = 'unsafe\nconfigured-key'
      const requests: string[] = []
      const server = await createGatewayServer((url) => requests.push(url))
      writeManualApiKey(server.baseURL)
      writeOfficialToken(server.baseURL)
      const config = { provider: { litellm: { options: { baseURL: `${server.baseURL}/v1`, apiKey }, models: {} } } }
      const hooks = await plugin([], InstallAuth.Environment)

      await hooks.config?.(config)

      await expect(runSearch(hooks)).rejects.toThrow('base URL')
      expect(requests).toEqual([])
      expect(config.provider.litellm.options.apiKey).toBe(apiKey)
      expect(native).not.toHaveBeenCalled()
    },
  )

  test.each([InstallAuth.Environment, InstallAuth.Sso])('uses only the selected store when both credentials match (%s)', async (auth) => {
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => authorizationByRoute.set(url, authorization))
    writeManualApiKey(server.baseURL)
    writeOfficialToken(server.baseURL)
    const hooks = await plugin([], auth)

    await hooks.config?.(configured(server.baseURL, ''))
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, auth === InstallAuth.Environment ? 'manual-key' : 'official-key')
    expect(native).toHaveBeenCalledTimes(auth === InstallAuth.Sso ? 1 : 0)
  })

  test.each([InstallAuth.Environment, InstallAuth.Sso])('does not cross to another store or ambient key when the selected credential is unavailable (%s)', async (auth) => {
    setAmbientKeys()
    const requests: string[] = []
    const server = await createGatewayServer((url) => requests.push(url))
    if (auth === InstallAuth.Environment) writeOfficialToken(server.baseURL)
    else writeManualApiKey(server.baseURL)
    const hooks = await plugin([], auth)

    await hooks.config?.(configured(server.baseURL))

    await expect(runSearch(hooks)).rejects.toThrow('base URL')
    expect(requests).toEqual([])
    expect(native).not.toHaveBeenCalled()
  })

  test('retains native authentication for unannotated standalone configurations', async () => {
    const authorizationByRoute = new Map<string, string | undefined>()
    const server = await createGatewayServer((url, authorization) => authorizationByRoute.set(url, authorization))
    writeManualApiKey(server.baseURL)
    writeOfficialToken(server.baseURL)
    const hooks = await plugin()

    await hooks.config?.(configured(server.baseURL, ''))
    await runSearch(hooks)

    expectAuthorization(authorizationByRoute, 'official-key')
    expect(native).toHaveBeenCalledTimes(1)
  })
})
