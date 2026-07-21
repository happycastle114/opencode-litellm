import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const packageRoot = join(repositoryRoot, 'packages', 'codex-litellm')
const metadata = {
  repository: {
    type: 'git',
    url: 'git+https://github.com/happycastle114/opencode-litellm.git',
  },
  bugs: { url: 'https://github.com/happycastle114/opencode-litellm/issues' },
  homepage: 'https://github.com/happycastle114/opencode-litellm#readme',
} as const

describe('codex-litellm package metadata', () => {
  test('packs the declared metadata and publish payload', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

    expect(manifest.name).toBe('@happycastle114/codex-litellm')
    expect(manifest.repository).toEqual(metadata.repository)
    expect(manifest.bugs).toEqual(metadata.bugs)
    expect(manifest.homepage).toBe(metadata.homepage)
    expect(manifest.files).toEqual(['bin', 'README.md', 'LICENSE'])
    expect(manifest.bin).toEqual({ 'codex-litellm': './bin/codex-litellm.mjs' })
    expect(manifest.publishConfig).toEqual({
      access: 'public',
      registry: 'https://npm.pkg.github.com',
    })

    const cacheRoot = mkdtempSync(join(tmpdir(), 'codex-litellm-package-metadata-'))
    try {
      const packed = spawnSync(
        'npm',
        ['pack', '--json', '--dry-run', '--ignore-scripts'],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            npm_config_cache: cacheRoot,
          },
        },
      )

      expect(packed.status).toBe(0)
      expect(packed.stderr).toBe('')
      const [entry] = JSON.parse(packed.stdout) as Array<{
        files: Array<{ path: string }>
      }>
      expect(entry.files.map((file) => file.path).sort()).toEqual([
        'LICENSE',
        'README.md',
        'bin/codex-litellm.mjs',
        'package.json',
      ])
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true })
    }
  })
})
