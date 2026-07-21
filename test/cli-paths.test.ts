import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCodexConfigPath, resolveOpenCodeConfigPath } from '../src/cli/paths'
import { writeConfigAtomic } from '../src/cli/file-adapter'

describe('opencode config path resolution', () => {
  test('prefers an explicit override path', () => {
    // Given: an explicit override
    // When: resolved
    const path = resolveOpenCodeConfigPath('/custom/opencode.jsonc', {
      HOME: '/home/tester',
    })

    // Then: the override wins verbatim
    expect(path).toBe('/custom/opencode.jsonc')
  })

  test('uses XDG_CONFIG_HOME when set', () => {
    // Given: an XDG config home
    // When: resolved without an override
    const path = resolveOpenCodeConfigPath(undefined, {
      HOME: '/home/tester',
      XDG_CONFIG_HOME: '/home/tester/.xdg',
    })

    // Then: the opencode config lands under the XDG root
    expect(path).toBe('/home/tester/.xdg/opencode/opencode.jsonc')
  })

  test('falls back to HOME/.config when XDG is unset', () => {
    // Given: only HOME
    // When: resolved
    const path = resolveOpenCodeConfigPath(undefined, { HOME: '/home/tester' })

    // Then: the default config path is derived from HOME
    expect(path).toBe('/home/tester/.config/opencode/opencode.jsonc')
  })

  test('preserves an existing opencode.json when no jsonc config exists', () => {
    // Given: an OpenCode installation that already uses opencode.json
    const configHome = mkdtempSync(join(tmpdir(), 'oc-litellm-path-'))
    const configDirectory = join(configHome, 'opencode')
    const jsonPath = join(configDirectory, 'opencode.json')
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(jsonPath, '{}\n')

    try {
      // When: the default path is resolved
      const path = resolveOpenCodeConfigPath(undefined, { XDG_CONFIG_HOME: configHome })

      // Then: the installer edits the existing config instead of creating a parallel file
      expect(path).toBe(jsonPath)
    } finally {
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  test('prefers an existing opencode.jsonc when both config formats exist', () => {
    // Given: both supported config filenames are present
    const configHome = mkdtempSync(join(tmpdir(), 'oc-litellm-path-'))
    const configDirectory = join(configHome, 'opencode')
    const jsoncPath = join(configDirectory, 'opencode.jsonc')
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(join(configDirectory, 'opencode.json'), '{}\n')
    writeFileSync(jsoncPath, '{}\n')

    try {
      // When: the default path is resolved
      const path = resolveOpenCodeConfigPath(undefined, { XDG_CONFIG_HOME: configHome })

      // Then: the established jsonc default retains priority
      expect(path).toBe(jsoncPath)
    } finally {
      rmSync(configHome, { recursive: true, force: true })
    }
  })
})

describe('codex config path resolution', () => {
  test('accepts only the runtime-visible config.toml basename', () => {
    expect(resolveCodexConfigPath('/custom/codex/config.toml', {})).toBe(
      '/custom/codex/config.toml',
    )
    expect(() => resolveCodexConfigPath('/custom/codex/alternate.toml', {})).toThrow(
      "Codex config path must end in 'config.toml'.",
    )
  })
})

describe('atomic config writes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oc-litellm-write-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('creates parent directories and writes the config contents', () => {
    // Given: a nested target path that does not exist yet
    const path = join(dir, 'nested', 'opencode', 'opencode.jsonc')
    // When: written atomically
    writeConfigAtomic(path, '{ "ok": true }\n', { now: () => new Date(0) })

    // Then: the file exists with the expected contents
    expect(readFileSync(path, 'utf8')).toBe('{ "ok": true }\n')
  })

  test('applies restrictive file permissions on POSIX', () => {
    // Given: a fresh config path
    const path = join(dir, 'opencode.jsonc')
    // When: written
    writeConfigAtomic(path, '{}\n', { now: () => new Date(0) })

    // Then: the mode is 0600 on POSIX platforms
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  test('creates a deterministic backup only when replacing an existing file', () => {
    // Given: an existing config
    const path = join(dir, 'opencode.jsonc')
    writeConfigAtomic(path, '{ "old": true }\n', { now: () => new Date(0) })
    // When: overwritten with an injected timestamp
    const fixedTime = new Date('2026-01-02T03:04:05.000Z')
    writeConfigAtomic(path, '{ "new": true }\n', { now: () => fixedTime })

    // Then: a deterministic backup preserves the prior contents
    const backup = join(dir, 'opencode.jsonc.20260102T030405.bak')
    expect(existsSync(backup)).toBe(true)
    expect(readFileSync(backup, 'utf8')).toBe('{ "old": true }\n')
    expect(readFileSync(path, 'utf8')).toBe('{ "new": true }\n')
  })

  test('does not create a backup for a brand-new file', () => {
    // Given: a path with no existing file
    const path = join(dir, 'opencode.jsonc')
    // When: written for the first time
    writeConfigAtomic(path, '{}\n', { now: () => new Date(0) })

    // Then: no backup is produced
    const backups = readFileSync
    void backups
    expect(existsSync(`${path}.19700101T000000.bak`)).toBe(false)
  })
})
