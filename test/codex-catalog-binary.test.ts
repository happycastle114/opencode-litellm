import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCodexCatalog, renderCodexOAuthConfig } from '../src/cli/codex-config'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import { QWEN_GATEWAY_MODEL } from '../src/cli/qwen-routing'

const codexBinary = Bun.which('codex')

describe('Codex model catalog binary compatibility', () => {
  test.skipIf(codexBinary === null)('is accepted by the installed Codex model parser', () => {
    // Given: an isolated Codex home containing only the generated catalog
    if (codexBinary === null) return
    const root = mkdtempSync(join(tmpdir(), 'opencode-litellm-codex-catalog-'))
    const codexHome = join(root, '.codex')
    const catalogPath = join(codexHome, 'litellm-models.json')
    mkdirSync(codexHome, { recursive: true })
    const bundled = readBundledCodexCatalog()
    const catalog = buildCodexCatalog([
      { id: 'coding-fast' },
      { id: QWEN_GATEWAY_MODEL },
    ], bundled.template)
    writeFileSync(catalogPath, catalog.json)
    writeFileSync(
      join(codexHome, 'config.toml'),
      `model_catalog_json = ${JSON.stringify(catalogPath)}\n`,
    )

    try {
      // When: the installed Codex binary parses and renders the custom catalog
      const result = spawnSync(codexBinary, ['debug', 'models'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          HOME: root,
        },
      })

      // Then: parsing succeeds and preserves the generated model row
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      const payload = JSON.parse(result.stdout)
      const expected = JSON.parse(catalog.json)
      expect(payload.models.map((model: { readonly slug: string }) => model.slug)).toEqual([
        'coding-fast',
        QWEN_GATEWAY_MODEL,
      ])
      expect(payload.models).toEqual(expected.models)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.skipIf(codexBinary === null)(
    'parses the exact OAuth catalog, accepts the named profile, and loads selected MCP resources',
    () => {
      if (codexBinary === null) return
      const root = mkdtempSync(join(tmpdir(), 'opencode-litellm-codex-oauth-profile-'))
      const codexHome = join(root, '.codex')
      const catalogPath = join(codexHome, 'litellm-codex-oauth-models.json')
      mkdirSync(codexHome, { recursive: true })
      const bundled = readBundledCodexCatalog()
      writeFileSync(catalogPath, bundled.json)
      writeFileSync(join(codexHome, 'config.toml'), '')
      const oauthConfig = renderCodexOAuthConfig({
        baseUrl: 'https://gateway.example.test',
        authEnv: 'LITELLM_PROXY_API_KEY',
        catalogPath,
        defaultModel: bundled.defaultModel,
        mcp: ['research_docs'],
        toolsets: ['research core'],
        disableMcp: [],
      })
      writeFileSync(join(codexHome, 'codex-oauth.config.toml'), oauthConfig)

      try {
        const env = {
          ...process.env,
          CODEX_HOME: codexHome,
          HOME: root,
          LITELLM_PROXY_API_KEY: 'isolated-fixture-key',
        }
        const models = spawnSync(codexBinary, [
          'debug', 'models', '-c', `model_catalog_json=${JSON.stringify(catalogPath)}`,
        ], { encoding: 'utf8', env })
        const profile = spawnSync(codexBinary, [
          '--profile', 'codex-oauth', 'debug', 'prompt-input', 'fixture',
        ], { encoding: 'utf8', env })
        writeFileSync(join(codexHome, 'config.toml'), oauthConfig)
        const mcp = spawnSync(codexBinary, ['mcp', 'list', '--json'], {
          encoding: 'utf8', env,
        })

        expect(models.error).toBeUndefined()
        expect(models.status, models.stderr).toBe(0)
        const payload = JSON.parse(models.stdout)
        expect(payload.models).toEqual(JSON.parse(bundled.json).models)
        expect(profile.error).toBeUndefined()
        expect(profile.status, profile.stderr).toBe(0)
        expect(mcp.error).toBeUndefined()
        expect(mcp.status, mcp.stderr).toBe(0)
        const servers = JSON.parse(mcp.stdout) as Array<{
          readonly name: string
          readonly enabled: boolean
          readonly transport: { readonly url: string }
        }>
        expect(servers).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'litellm_research_docs',
            enabled: true,
            transport: expect.objectContaining({
              url: 'https://gateway.example.test/research_docs/mcp',
            }),
          }),
          expect.objectContaining({
            name: 'litellm_toolset_research_core',
            enabled: true,
            transport: expect.objectContaining({
              url: 'https://gateway.example.test/toolset/research%20core/mcp',
            }),
          }),
        ]))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
