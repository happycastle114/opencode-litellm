import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN_NAME = {
  OpenCode: 'opencode-litellm',
  Codex: 'codex-litellm',
} as const

const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const coreManifestPath = join(repositoryRoot, 'package.json')
const wrapperRoot = join(repositoryRoot, 'packages', 'codex-litellm')
const wrapperManifestPath = join(wrapperRoot, 'package.json')
const wrapperEntrypoint = join(wrapperRoot, 'bin', 'codex-litellm.mjs')

describe('package distribution', () => {
  test('publishes both client-facing binary aliases from the core package', () => {
    // Given: the package that owns the shared installer implementation
    const manifest = readJsonObject(coreManifestPath)

    // When: npm reads its binary map
    const bins = manifest.bin

    // Then: both public command names resolve to packaged executables
    expect(isRecord(bins)).toBe(true)
    if (!isRecord(bins)) return
    expect(Object.keys(bins).sort()).toEqual([
      BIN_NAME.Codex,
      BIN_NAME.OpenCode,
    ])
    for (const path of Object.values(bins)) {
      expect(typeof path).toBe('string')
      if (typeof path !== 'string') return
      expect(existsSync(join(repositoryRoot, path))).toBe(true)
    }
  })

  test('keeps the codex-litellm wrapper pinned to the exact core version', () => {
    // Given: the core package and its thin Codex compatibility wrapper
    expect(existsSync(wrapperManifestPath)).toBe(true)
    const core = readJsonObject(coreManifestPath)
    const wrapper = readJsonObject(wrapperManifestPath)

    // When: their publish metadata is compared
    const dependencies = wrapper.dependencies

    // Then: the wrapper has one public bin and an exact core dependency
    expect(wrapper.name).toBe(BIN_NAME.Codex)
    expect(wrapper.bin).toHaveProperty(BIN_NAME.Codex)
    expect(isRecord(dependencies)).toBe(true)
    if (!isRecord(dependencies) || typeof core.name !== 'string') return
    expect(dependencies[core.name]).toBe(core.version)
  })

  test('packs the codex-litellm wrapper with its executable entrypoint', () => {
    // Given: the local wrapper package without registry access
    expect(existsSync(wrapperManifestPath)).toBe(true)
    if (!existsSync(wrapperManifestPath)) return
    const manifest = readJsonObject(wrapperManifestPath)

    // When: npm performs the same dry-run inventory used before publishing
    const packed = spawnSync(
      'npm',
      ['pack', '--json', '--dry-run', '--ignore-scripts'],
      {
        cwd: wrapperRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_config_cache: join(tmpdir(), 'opencode-litellm-npm-test-cache'),
        },
      },
    )

    // Then: npm accepts the package and includes the declared executable
    expect(packed.status).toBe(0)
    expect(packed.stderr).toBe('')
    const inventory: unknown = JSON.parse(packed.stdout)
    expect(Array.isArray(inventory)).toBe(true)
    if (!Array.isArray(inventory)) return
    const entry: unknown = inventory[0]
    expect(isRecord(entry)).toBe(true)
    if (!isRecord(entry) || !isRecord(manifest.bin)) return
    const files = entry.files
    expect(Array.isArray(files)).toBe(true)
    if (!Array.isArray(files)) return
    const paths = files.flatMap((file) =>
      isRecord(file) && typeof file.path === 'string' ? [file.path] : [],
    )
    const executable = manifest.bin[BIN_NAME.Codex]
    expect(typeof executable).toBe('string')
    if (typeof executable !== 'string') return
    expect(paths).toContain(executable.replace(/^\.\//, ''))
  })

  test('defaults a bare wrapper install to the Codex target', () => {
    // Given: the published wrapper resolving a real executable core package
    const fixture = createWrapperFixture()

    try {
      // When: the Codex alias launches install without an explicit target
      const result = spawnSync(
        process.execPath,
        [fixture.executable, 'install', '--non-interactive'],
        { encoding: 'utf8' },
      )

      // Then: the core receives the Codex target before the remaining options
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([
        'install',
        '--target',
        'codex',
        '--non-interactive',
      ])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('preserves an explicit install target through the Codex wrapper', () => {
    // Given: the published wrapper resolving a real executable core package
    const fixture = createWrapperFixture()

    try {
      // When: the caller chooses a target explicitly
      const result = spawnSync(
        process.execPath,
        [fixture.executable, 'install', '--target', 'both'],
        { encoding: 'utf8' },
      )

      // Then: the wrapper forwards the caller's arguments byte-for-byte
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([
        'install',
        '--target',
        'both',
      ])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('preserves non-install commands through the Codex wrapper', () => {
    // Given: the published wrapper resolving a real executable core package
    const fixture = createWrapperFixture()

    try {
      // When: the caller invokes a built-in lifecycle command
      const result = spawnSync(
        process.execPath,
        [fixture.executable, 'whoami', '--verbose'],
        { encoding: 'utf8' },
      )

      // Then: the wrapper does not inject install-only arguments
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['whoami', '--verbose'])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

type WrapperFixture = {
  readonly root: string
  readonly executable: string
}

function createWrapperFixture(): WrapperFixture {
  const root = mkdtempSync(join(tmpdir(), 'codex-litellm-wrapper-test-'))
  const executable = join(root, 'packages', 'codex-litellm', 'bin', 'codex-litellm.mjs')
  const coreRoot = join(
    root,
    'packages',
    'codex-litellm',
    'node_modules',
    '@happycastle114',
    'opencode-litellm',
  )

  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(coreRoot, { recursive: true })
  copyFileSync(wrapperEntrypoint, executable)
  writeFileSync(
    join(coreRoot, 'package.json'),
    `${JSON.stringify({
      name: '@happycastle114/opencode-litellm',
      version: '0.6.0',
      type: 'module',
      exports: { './cli': './fake-cli.mjs' },
    })}\n`,
  )
  writeFileSync(
    join(coreRoot, 'fake-cli.mjs'),
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n",
  )

  return { root, executable }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object at ${path}.`)
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
