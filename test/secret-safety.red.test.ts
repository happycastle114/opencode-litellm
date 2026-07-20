import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCliProgram } from '../src/cli/program'
import { parse as parseToml } from 'smol-toml'

const SECRET = 'sk-test-secret-should-never-be-written'
const JWT_DECOY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.decoy.payload'

describe('generated client assets', () => {
  test('contain no secret or JWT decoy and choose exactly one auth source per profile', async () => {
    const home = mkdtempSync(join(tmpdir(), 'litellm-secret-safety-'))
    const configPath = join(home, '.codex', 'config.toml')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ data: [{ id: 'coding-fast' }] })
    try {
      const result = await runCliProgram(['install', '--target', 'both', '--base-url', 'https://litellm.example.com', '--auth', 'env', '--auth-env', 'LITELLM_API_KEY', '--opencode-config', join(home, '.config/opencode/opencode.jsonc'), '--codex-config', configPath, '--non-interactive'], {
        env: { HOME: home, LITELLM_API_KEY: SECRET },
        now: () => new Date(0),
        bundledCodexCatalog: () => ({
          json: `${JSON.stringify({ models: [{ slug: 'gpt-test', visibility: 'list', supported_in_api: true, priority: 1 }] }, null, 2)}\n`,
          defaultModel: 'gpt-test',
        }),
      })
      expect(result.exitCode).toBe(0)
      expect(existsSync(join(home, '.litellm', 'token.json'))).toBe(false)
      const files = collectFiles(home)
      expect(files.some((path) => /oauth|profile|skill|helper/i.test(path))).toBe(true)
      for (const path of files) {
        const content = readFileSync(path, 'utf8')
        expect(content).not.toContain(SECRET)
        expect(content).not.toContain(JWT_DECOY)
      }
      const base = parseToml(readFileSync(configPath, 'utf8'))
      const gateway = base.model_providers?.litellm
      expect(gateway.env_key).toBe('LITELLM_API_KEY')
      expect(gateway.auth).toBeUndefined()
      expect(gateway.requires_openai_auth).toBeUndefined()
      const profilePath = join(home, '.codex', 'codex-oauth.config.toml')
      const profile = parseToml(readFileSync(profilePath, 'utf8'))
      const oauth = profile.model_providers?.['litellm-codex-oauth']
      expect(oauth.requires_openai_auth).toBe(true)
      expect(oauth.env_http_headers).toEqual({ 'x-litellm-api-key': 'LITELLM_API_KEY' })
      expect(oauth.env_key).toBeUndefined()
      expect(oauth.auth).toBeUndefined()
    } finally { globalThis.fetch = originalFetch; rmSync(home, { recursive: true, force: true }) }
  })
})

function collectFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}
