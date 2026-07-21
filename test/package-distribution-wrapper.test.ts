import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupFixture,
  coreManifestPath,
  createWrapperFixture,
  getNodeRuntime,
  isRecord,
  packPackage,
  readJsonObject,
  wrapperManifestPath,
  wrapperRoot,
} from './package-distribution-test-support'

test('keeps the Codex wrapper pinned to the exact core version', () => {
  const core = readJsonObject(coreManifestPath)
  const wrapper = readJsonObject(wrapperManifestPath)
  const dependencies = wrapper.dependencies

  expect(wrapper.name).toBe('@happycastle114/codex-litellm')
  expect(wrapper.bin).toEqual({ 'codex-litellm': './bin/codex-litellm.mjs' })
  expect(isRecord(dependencies)).toBe(true)
  if (!isRecord(dependencies) || typeof core.name !== 'string') return
  expect(dependencies[core.name]).toBe(core.version)
})

test('packs the Codex wrapper with its declared executable entrypoint', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'codex-litellm-wrapper-pack-'))
  try {
    const packed = packPackage(wrapperRoot, fixtureRoot)
    const wrapper = readJsonObject(wrapperManifestPath)
    const bin = wrapper.bin
    expect(isRecord(bin)).toBe(true)
    if (!isRecord(bin)) return
    const executable = bin['codex-litellm']
    expect(typeof executable).toBe('string')
    if (typeof executable !== 'string') return
    expect(packed.files.map(({ path }) => path)).toContain(executable.replace(/^\.\//, ''))
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('defaults a bare wrapper install to the Codex target', () => {
  const fixture = createWrapperFixture()
  try {
    const result = spawnSync(getNodeRuntime().executable, [fixture.executable, 'install', '--non-interactive'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['install', '--target', 'codex', '--non-interactive'])
  } finally {
    cleanupFixture(fixture.root)
  }
})

test('preserves terminal input for a bare interactive Codex install', () => {
  const fixture = createWrapperFixture()
  try {
    const fakeCli = join(
      fixture.root,
      'packages',
      'codex-litellm',
      'node_modules',
      '@happycastle114',
      'opencode-litellm',
      'fake-cli.mjs',
    )
    writeFileSync(fakeCli, `
const chunks = []
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), stdin: chunks.join('') }))
})
`)
    const result = spawnSync(
      getNodeRuntime().executable,
      [fixture.executable, 'install'],
      { encoding: 'utf8', input: 'interactive-answer\n', timeout: 5_000 },
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      args: ['install', '--target', 'codex'],
      stdin: 'interactive-answer\n',
    })
  } finally {
    cleanupFixture(fixture.root)
  }
})

test('preserves an explicit install target through the Codex wrapper', () => {
  const fixture = createWrapperFixture()
  try {
    const result = spawnSync(getNodeRuntime().executable, [fixture.executable, 'install', '--target', 'both'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['install', '--target', 'both'])
  } finally {
    cleanupFixture(fixture.root)
  }
})

test('preserves non-install commands through the Codex wrapper', () => {
  const fixture = createWrapperFixture()
  try {
    const result = spawnSync(getNodeRuntime().executable, [fixture.executable, 'whoami', '--verbose'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['whoami', '--verbose'])
  } finally {
    cleanupFixture(fixture.root)
  }
})
