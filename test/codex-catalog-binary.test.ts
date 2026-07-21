import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCodexCatalog } from '../src/cli/codex-config'
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
      expect(payload.models.map((model: { readonly slug: string }) => model.slug)).toEqual([
        'coding-fast',
        QWEN_GATEWAY_MODEL,
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
