import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { installPreparedClients } from '../src/cli/client-installer'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import {
  BUNDLED_CATALOG,
  VALUE,
  bundledCatalog,
  createHomeDirectory,
  preparedInstall,
} from './client-installer-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = createHomeDirectory()
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('prepared client installer', () => {
  test('installs only the gateway Codex catalog and recoverably retires the OAuth profile', async () => {
    // Given: gateway mode, user-owned main settings, and an existing managed OAuth profile
    const configPath = join(homeDirectory, '.codex', 'config.toml')
    const profilePath = join(homeDirectory, '.codex', 'codex-oauth.config.toml')
    const oauthCatalogPath = join(homeDirectory, '.codex', 'litellm-codex-oauth-models.json')
    mkdirSync(join(homeDirectory, '.codex'), { recursive: true })
    writeFileSync(configPath, 'approval_policy = "on-request"\n')
    writeFileSync(profilePath, 'managed = true\n')
    writeFileSync(oauthCatalogPath, '{"models":[]}\n')
    let bundledCatalogReads = 0

    // When: the prepared gateway-only installation is applied
    const installGateway = () => installPreparedClients(preparedInstall({
      target: InstallTarget.Codex,
      auth: InstallAuth.Sso,
      codexConfig: configPath,
      codexMode: CodexMode.Gateway,
    }), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      bundledCodexCatalog: () => {
        bundledCatalogReads += 1
        return bundledCatalog()
      },
    })
    await installGateway()
    await installGateway()

    // Then: the main config is gateway-backed and no unselected OAuth catalog is written
    const config = parseToml(readFileSync(configPath, 'utf8'))
    const catalog: unknown = JSON.parse(readFileSync(config.model_catalog_json, 'utf8'))
    expect(config).toMatchObject({
      approval_policy: 'on-request',
      model: 'gateway-model',
      model_provider: 'litellm-gateway-sso',
    })
    expect(catalog).toHaveProperty('models.0.slug', 'gateway-model')
    expect(config.mcp_servers).toHaveProperty('litellm_mcp_visible')
    expect(config.mcp_servers).toHaveProperty('litellm_toolset_toolset_visible')
    expect(bundledCatalogReads).toBe(2)
    expect(existsSync(oauthCatalogPath)).toBe(false)
    expect(existsSync(profilePath)).toBe(false)
    const managedBackups = readdirSync(join(homeDirectory, '.codex'))
    expect(managedBackups.filter(
      (name) => name.startsWith('codex-oauth.config.toml.') && name.endsWith('.bak'),
    )).toHaveLength(1)
    expect(managedBackups.filter(
      (name) => name.startsWith('litellm-codex-oauth-models.json.') && name.endsWith('.bak'),
    )).toHaveLength(1)
  })

  test('makes OAuth the main Codex profile with the exact bundled catalog and selected resources', async () => {
    // Given: OAuth mode, an existing main config, and a stale secondary profile
    const configPath = join(homeDirectory, '.codex', 'config.toml')
    const profilePath = join(homeDirectory, '.codex', 'codex-oauth.config.toml')
    const gatewayCatalogPath = join(homeDirectory, '.codex', 'litellm-models.json')
    const oauthCatalogPath = join(homeDirectory, '.codex', 'litellm-codex-oauth-models.json')
    mkdirSync(join(homeDirectory, '.codex'), { recursive: true })
    writeFileSync(configPath, 'approval_policy = "never"\n')
    writeFileSync(profilePath, 'stale = true\n')
    writeFileSync(gatewayCatalogPath, '{"models":[]}\n')
    const bundled = bundledCatalog()

    // When: the prepared OAuth-only installation is applied
    const installOAuth = () => installPreparedClients(preparedInstall({
      target: InstallTarget.Codex,
      codexConfig: configPath,
      codexMode: CodexMode.OAuth,
    }), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      bundledCodexCatalog: () => bundled,
    })
    await installOAuth()
    await installOAuth()

    // Then: OAuth owns the main config and no gateway or secondary catalog is materialized
    const config = parseToml(readFileSync(configPath, 'utf8'))
    const provider = config.model_providers?.['litellm-codex-oauth']
    expect(config).toMatchObject({
      approval_policy: 'never',
      model: BUNDLED_CATALOG.defaultModel,
      model_provider: 'litellm-codex-oauth',
      forced_login_method: 'chatgpt',
    })
    expect(provider).toMatchObject({
      requires_openai_auth: true,
      env_http_headers: { 'x-litellm-api-key': VALUE.AuthEnvironment },
    })
    expect(config.mcp_servers).toHaveProperty('litellm_mcp_visible')
    expect(config.mcp_servers).toHaveProperty('litellm_toolset_toolset_visible')
    expect(readFileSync(config.model_catalog_json, 'utf8')).toBe(bundled.json)
    expect(config.model_catalog_json).toBe(oauthCatalogPath)
    expect(existsSync(gatewayCatalogPath)).toBe(false)
    expect(existsSync(profilePath)).toBe(false)
    const managedBackups = readdirSync(join(homeDirectory, '.codex'))
    expect(managedBackups.filter(
      (name) => name.startsWith('litellm-models.json.') && name.endsWith('.bak'),
    )).toHaveLength(1)
    expect(readFileSync(configPath, 'utf8')).not.toContain(VALUE.ApiKey)
  })

  test('installs both clients and both Codex profiles with their selected catalogs and resources', async () => {
    // Given: both client targets and both genuine Codex connection modes
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const codexPath = join(homeDirectory, '.codex', 'config.toml')
    const oauthProfilePath = join(homeDirectory, '.codex', 'codex-oauth.config.toml')
    const bundled = bundledCatalog()

    // When: the combined prepared installation is applied
    const result = await installPreparedClients(preparedInstall({
      target: InstallTarget.Both,
      auth: InstallAuth.Sso,
      opencodeConfig: opencodePath,
      codexConfig: codexPath,
      codexMode: CodexMode.Both,
    }), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
      bundledCodexCatalog: () => bundled,
    })

    // Then: each client path is reported and each Codex profile owns its matching catalog
    const main = parseToml(readFileSync(codexPath, 'utf8'))
    const oauth = parseToml(readFileSync(oauthProfilePath, 'utf8'))
    expect(result.configured).toEqual([
      { client: InstallTarget.OpenCode, path: opencodePath },
      { client: InstallTarget.Codex, path: codexPath },
    ])
    expect(main.model_provider).toBe('litellm-gateway-sso')
    expect(JSON.parse(readFileSync(main.model_catalog_json, 'utf8'))).toHaveProperty(
      'models.0.slug',
      'gateway-model',
    )
    expect(main.mcp_servers).toHaveProperty('litellm_mcp_visible')
    expect(main.mcp_servers).toHaveProperty('litellm_toolset_toolset_visible')
    expect(oauth.model_provider).toBe('litellm-codex-oauth')
    expect(readFileSync(oauth.model_catalog_json, 'utf8')).toBe(bundled.json)
    expect(oauth.mcp_servers).toHaveProperty('litellm_mcp_visible')
    expect(oauth.mcp_servers).toHaveProperty('litellm_toolset_toolset_visible')
  })
})
