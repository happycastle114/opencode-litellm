import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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
