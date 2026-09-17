import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const BATCH_PATH = join(ROOT, 'scripts', 'setup-windows.bat')
const GUIDE_PATH = join(ROOT, 'docs', 'README.windows.md')

describe('Windows setup assets', () => {
  test('ships a non-forwarding batch installer for both clients', () => {
    // Given: the repository Windows bootstrap path
    expect(existsSync(BATCH_PATH)).toBe(true)

    // When: the batch program is inspected as a command contract
    const source = readFileSync(BATCH_PATH, 'utf8')

    // Then: it invokes only the managed latest installer and never forwards raw arguments
    expect(source).toContain('call npx --yes @happycastle/opencode-litellm@latest install --target both')
    expect(source).toContain('where node')
    expect(source).toContain('where npx')
    expect(source).not.toContain('%*')
    expect(source).not.toMatch(/%~?[0-9]/)
  })

  test('documents native Windows verification and official Codex references', () => {
    // Given: the Windows operator guide
    expect(existsSync(GUIDE_PATH)).toBe(true)

    // When: machine-consumed commands and source links are read
    const guide = readFileSync(GUIDE_PATH, 'utf8')

    // Then: setup, diagnostics, and official platform guidance are present
    expect(guide).toContain('scripts\\setup-windows.bat')
    const common = readFileSync(join(ROOT, 'docs', 'client-setup.md'), 'utf8')
    expect(common).toContain('doctor --target both --json')
    expect(guide).toMatch(/\bPython\b/)
    expect(guide).toContain('uv tool install "litellm[cli]==1.101.0"')
    expect(guide).toContain('lite --version')
    expect(guide).toContain('lite login --pkce')
    expect(guide).toContain('%USERPROFILE%\\.config\\opencode-litellm\\api-key.json')
    expect(guide).toContain('npx.cmd --yes @happycastle/codex-litellm@latest codex --profile codex-oauth')
    expect(guide).toContain('https://docs.astral.sh/uv/getting-started/installation/')
    expect(guide).toContain('https://developers.openai.com/codex/cli')
    expect(guide).toContain('https://developers.openai.com/codex/windows')
    expect(guide).toContain('https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/commands/auth.py')
  })
})
