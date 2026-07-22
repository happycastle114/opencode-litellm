import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installOpenCodeSkill } from '../src/cli/skill-install'

const SKILL_PATH = join(
  import.meta.dir,
  '..',
  'skills',
  'litellm-research-router',
  'SKILL.md',
)
const PACKAGING_TEST_TIMEOUT_MS = 30_000

test('ships valid frontmatter and includes the skill in the package inventory', {
  timeout: PACKAGING_TEST_TIMEOUT_MS,
}, () => {
  const skillContents = readFileSync(SKILL_PATH, 'utf8')
  const frontmatter = parseFrontmatter(skillContents)
  expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name'])
  expect(frontmatter.name).toBe('litellm-research-router')
  expect(typeof frontmatter.description).toBe('string')
  expect(frontmatter.description.length).toBeGreaterThan(0)

  const packed = spawnSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
    cwd: join(import.meta.dir, '..'),
    encoding: 'utf8',
  })
  expect(packed.status).toBe(0)
  const [entry] = JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>
  expect(entry.files.map((file) => file.path)).toContain('skills/litellm-research-router/SKILL.md')
})

test('installs the packaged skill byte-for-byte and converges its mode', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencode-litellm-skill-package-'))
  try {
    const homeDirectory = join(fixtureRoot, 'home')
    mkdirSync(homeDirectory, { recursive: true })
    const first = installOpenCodeSkill({
      homeDirectory,
      skillName: 'litellm-research-router',
      sourcePath: SKILL_PATH,
    })
    const sourceBytes = readFileSync(SKILL_PATH)
    expect(readFileSync(first.destination)).toEqual(sourceBytes)
    chmodSync(first.destination, 0o644)

    const second = installOpenCodeSkill({
      homeDirectory,
      skillName: 'litellm-research-router',
      sourcePath: SKILL_PATH,
    })
    expect(second.status).toBe('unchanged')
    expect(readFileSync(second.destination)).toEqual(sourceBytes)
    if (process.platform !== 'win32') expect(statSync(second.destination).mode & 0o777).toBe(0o600)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

function parseFrontmatter(contents: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(contents)
  if (!match) throw new Error('Skill is missing YAML frontmatter')
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`Invalid frontmatter field: ${line}`)
    fields[line.slice(0, separator)] = line.slice(separator + 1).trim()
  }
  return fields
}
