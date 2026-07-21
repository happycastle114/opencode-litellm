import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planOpenCodeEdits, applyOpenCodeEdits } from '../src/cli/opencode-config'
import { renderCodexConfig } from '../src/cli/codex-config'
import { retireConfigFile, writeConfigAtomic } from '../src/cli/file-adapter'

const intent = { baseUrl: 'https://litellm.example.com', authEnv: 'LITELLM_API_KEY', search: [], mcp: [], disableMcp: [] } as const
const codexIntent = { ...intent, catalogPath: '/tmp/models.json', defaultModel: 'coding-fast' } as const

describe('atomic configuration writes', () => {
  test('backs up only changed content and is byte-stable on identical writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litellm-atomic-'))
    try {
      const path = join(dir, 'config.toml')
      const now = () => new Date('2026-01-02T03:04:05.000Z')
      writeConfigAtomic(path, 'approval_policy = "on-request"\n', { now })
      writeConfigAtomic(path, 'approval_policy = "on-request"\n', { now })
      expect(readdirSync(dir).filter((name) => name.endsWith('.bak'))).toHaveLength(0)
      const before = readFileSync(path)
      writeConfigAtomic(path, 'approval_policy = "never"\n', { now })
      expect(readdirSync(dir).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
      expect(readFileSync(path)).not.toEqual(before)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('tightens identical configuration content to owner-only permissions', () => {
    // Given: identical managed contents left with an overly broad mode
    const dir = mkdtempSync(join(tmpdir(), 'litellm-atomic-mode-'))
    const path = join(dir, 'config.json')
    const contents = '{"customHeaders":{"X-Admission":"{env:GATEWAY_KEY}"}}\n'
    try {
      writeFileSync(path, contents)
      if (process.platform !== 'win32') chmodSync(path, 0o644)

      // When: the atomic writer sees byte-identical content
      writeConfigAtomic(path, contents, { now: () => new Date(0) })

      // Then: it creates no backup but still enforces the 0600 contract
      expect(readFileSync(path, 'utf8')).toBe(contents)
      expect(readdirSync(dir).filter((name) => name.endsWith('.bak'))).toEqual([])
      if (process.platform !== 'win32') {
        expect(statSync(path).mode & 0o777).toBe(0o600)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('retires a managed profile to a recoverable backup and is absent-idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litellm-retire-'))
    try {
      const path = join(dir, 'codex-oauth.config.toml')
      const now = () => new Date('2026-01-02T03:04:05.000Z')
      writeFileSync(path, 'managed = true\n')

      const backup = retireConfigFile(path, { now })

      expect(backup).toBe(`${path}.20260102T030405.bak`)
      expect(existsSync(path)).toBe(false)
      expect(readFileSync(backup ?? '', 'utf8')).toBe('managed = true\n')
      expect(retireConfigFile(path, { now })).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('fails malformed JSONC/TOML before creating or changing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litellm-invalid-'))
    const jsonPath = join(dir, 'opencode.jsonc')
    const tomlPath = join(dir, 'config.toml')
    writeFileSync(jsonPath, '{ "keep": true }\n')
    writeFileSync(tomlPath, 'approval_policy = "on-request"\n')
    try {
      expect(() => applyOpenCodeEdits('{ broken', planOpenCodeEdits('{ broken', intent, jsonPath))).toThrow()
      expect(() => renderCodexConfig('[broken', codexIntent)).toThrow()
      expect(readFileSync(jsonPath, 'utf8')).toContain('keep')
      expect(readFileSync(tomlPath, 'utf8')).toContain('on-request')
      expect(existsSync(`${jsonPath}.20260102T030405.bak`)).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('retains user keys, comments, and skills across both managed renders', () => {
    const json = applyOpenCodeEdits('{\n  // user comment\n  "theme": "dark",\n  "skills": ["user-skill"]\n}\n', planOpenCodeEdits('{\n  // user comment\n  "theme": "dark",\n  "skills": ["user-skill"]\n}\n', intent))
    const toml = renderCodexConfig('# user comment\napproval_policy = "on-request"\n[features]\nmulti_agent = true\n', codexIntent)
    expect(json).toContain('// user comment')
    expect(json).toContain('"user-skill"')
    expect(toml).toContain('# user comment')
    expect(toml).toContain('approval_policy = "on-request"')
  })
})
