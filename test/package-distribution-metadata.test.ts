import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  coreManifestPath,
  isRecord,
  readJsonObject,
  repositoryRoot,
} from './package-distribution-test-support'

const BIN_NAME = {
  OpenCode: 'opencode-litellm',
  Codex: 'codex-litellm',
} as const

test('publishes both client-facing binary aliases from the core package', () => {
  const manifest = readJsonObject(coreManifestPath)
  const bins = manifest.bin

  expect(isRecord(bins)).toBe(true)
  if (!isRecord(bins)) return
  expect(Object.keys(bins).sort()).toEqual([BIN_NAME.Codex, BIN_NAME.OpenCode])
  for (const path of Object.values(bins)) {
    expect(typeof path).toBe('string')
    if (typeof path !== 'string') return
    expect(existsSync(join(repositoryRoot, path))).toBe(true)
  }
  expect(manifest.publishConfig).toEqual({
    access: 'public',
    registry: 'https://npm.pkg.github.com',
  })
  expect(manifest.scripts).toMatchObject({ prepack: 'npm run build' })
})

test('keeps the public plugin declaration boundary local and callable', () => {
  const declaration = readFileSync(join(repositoryRoot, 'dist', 'plugin', 'index.d.ts'), 'utf8')
  const imports = [...declaration.matchAll(/^import .* from ['"]([^'"]+)['"];$/gm)].map(
    ([, specifier]) => specifier,
  )

  expect(imports.every((specifier) => specifier.startsWith('.'))).toBe(true)
  expect(declaration).toMatch(/export declare const LiteLLMPlugin:/)
  expect(declaration).toMatch(/export declare const LiteLLMResponsesPlugin:/)
  expect(declaration).toMatch(/Promise<PublicPluginHooks>/)
})
