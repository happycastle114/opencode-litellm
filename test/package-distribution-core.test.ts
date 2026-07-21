import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  coreManifestPath,
  createConsumer,
  getNodeRuntime,
  getNpmExecutable,
  installPackage,
  installTypeScriptTooling,
  isRecord,
  packPackage,
  readJsonObject,
  repositoryRoot,
} from './package-distribution-test-support'

test('packs, installs, imports, and typechecks the core package as a strict Node consumer', () => {
  const build = spawnSync(getNpmExecutable(), ['run', 'build'], { cwd: repositoryRoot, encoding: 'utf8', env: process.env })
  expect(build.status).toBe(0)

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencode-litellm-pack-test-'))
  try {
    const packed = packPackage(repositoryRoot, fixtureRoot)
    const paths = packed.files.map(({ path }) => path)
    expect(paths).toEqual(expect.arrayContaining([
      'dist/index.mjs',
      'dist/index.d.ts',
      'dist/plugin/index.d.ts',
      'dist/opencode-litellm.mjs',
      'skills/litellm-research-router/SKILL.md',
    ]))
    expect(paths).not.toContain('dist/plugin/build-model.d.ts')
    expect(paths).not.toContain('dist/plugin/discover.d.ts')

    const consumerRoot = createConsumer(fixtureRoot, 'opencode-litellm-package-consumer')
    installPackage(packed.filename, consumerRoot)
    const installedRoot = join(consumerRoot, 'node_modules', '@happycastle114', 'opencode-litellm')
    expect(existsSync(installedRoot)).toBe(true)
    expect(lstatSync(installedRoot).isSymbolicLink()).toBe(false)
    const manifest = readJsonObject(join(installedRoot, 'package.json'))
    const sourceManifest = readJsonObject(coreManifestPath)
    expect(manifest.name).toBe(sourceManifest.name)
    expect(manifest.version).toBe(sourceManifest.version)
    expect(existsSync(join(installedRoot, 'dist', 'index.mjs'))).toBe(true)
    expect(existsSync(join(installedRoot, 'dist', 'index.d.ts'))).toBe(true)

    const nodeRuntime = getNodeRuntime()
    const importProbe = join(consumerRoot, 'import-plugin.mjs')
    writeFileSync(importProbe, "const runtime = { release: process.release.name, version: process.version };\nconst plugin = await import('@happycastle114/opencode-litellm');\nconst hooks = await plugin.LiteLLMPlugin({});\nconst responses = await plugin.LiteLLMResponsesPlugin({});\nif (runtime.release !== 'node' || typeof plugin.LiteLLMPlugin !== 'function' || typeof plugin.LiteLLMResponsesPlugin !== 'function' || typeof hooks.config !== 'function' || typeof responses !== 'object') process.exit(1);\nprocess.stdout.write(JSON.stringify({ runtime, exports: Object.keys(plugin).sort(), hookKeys: Object.keys(hooks).sort() }));\n")
    const imported = spawnSync(nodeRuntime.executable, [importProbe], { cwd: consumerRoot, encoding: 'utf8', env: process.env })
    expect(imported.status).toBe(0)
    expect(imported.stderr).toBe('')
    const diagnostic: unknown = JSON.parse(imported.stdout)
    expect(isRecord(diagnostic)).toBe(true)
    if (!isRecord(diagnostic)) return
    expect(diagnostic.runtime).toEqual({ release: 'node', version: nodeRuntime.version })
    expect(diagnostic.exports).toEqual(['LiteLLMPlugin', 'LiteLLMResponsesPlugin'])
    expect(diagnostic.hookKeys).toEqual(['config'])

    const tsc = installTypeScriptTooling(consumerRoot)
    expect(existsSync(tsc)).toBe(true)
    expect(lstatSync(tsc).isSymbolicLink()).toBe(false)
    const typeProbe = join(consumerRoot, 'typecheck.mts')
    writeFileSync(typeProbe, "import { LiteLLMPlugin, LiteLLMResponsesPlugin } from '@happycastle114/opencode-litellm';\nimport type { LiteLLMModel } from '@happycastle114/opencode-litellm';\nconst model: LiteLLMModel = { id: 'packed-model', object: 'model' };\nvoid model; void LiteLLMPlugin({}); void LiteLLMResponsesPlugin({});\n")
    const typecheck = spawnSync(nodeRuntime.executable, [tsc, '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noEmit', typeProbe], { cwd: consumerRoot, encoding: 'utf8', env: process.env })
    if (typecheck.status !== 0) throw new Error(`Strict consumer typecheck failed (${typecheck.status}): ${typecheck.stdout}${typecheck.stderr}`)
    expect(typecheck.stderr).toBe('')
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}, 30_000)
