import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installOpenCodeSkill } from '../src/cli/skill-install'

const SKILL = {
  name: 'litellm-research-router',
  fileName: 'SKILL.md',
  contents: '# LiteLLM Research Router\n\nUse the authenticated LiteLLM runtime.\n',
} as const
const INSTALL_STATUS = { installed: 'installed', unchanged: 'unchanged' } as const
const ENVIRONMENT = { key: 'OPENCODE_LITELLM_API_KEY' } as const
const SECRET = {
  first: 'sk-first-secret-must-not-be-written',
  second: 'sk-second-secret-must-not-be-written',
} as const
const PLATFORM = { Windows: 'win32' } as const

const originalKey = process.env[ENVIRONMENT.key]
let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opencode-litellm-skill-'))
})

afterEach(() => {
  restoreEnvironmentKey(originalKey)
  rmSync(directory, { recursive: true, force: true })
})

describe('shared agent skill installation', () => {
  test('installs under the home-scoped shared agent skills directory', () => {
    // Given: a packaged skill and an isolated home directory
    const sourcePath = createSkillSource()
    const homeDirectory = join(directory, 'home')

    // When: the skill is installed
    const result = installOpenCodeSkill({
      homeDirectory,
      skillName: SKILL.name,
      sourcePath,
    })

    // Then: OpenCode and Codex share the canonical .agents destination
    const destination = join(
      homeDirectory,
      '.agents',
      'skills',
      SKILL.name,
      SKILL.fileName,
    )
    expect(result).toEqual({ status: INSTALL_STATUS.installed, destination })
    expect(readFileSync(destination, 'utf8')).toBe(SKILL.contents)
  })

  test('is byte-idempotent and never interpolates runtime secrets', () => {
    // Given: a packaged skill and two different runtime credentials across installs
    const sourcePath = createSkillSource()
    const homeDirectory = join(directory, 'home')
    process.env[ENVIRONMENT.key] = SECRET.first
    const first = installOpenCodeSkill({
      homeDirectory,
      skillName: SKILL.name,
      sourcePath,
    })
    const before = readFileSync(first.destination, 'utf8')
    if (process.platform !== PLATFORM.Windows) chmodSync(first.destination, 0o644)
    process.env[ENVIRONMENT.key] = SECRET.second

    // When: the same skill is installed again
    const second = installOpenCodeSkill({
      homeDirectory,
      skillName: SKILL.name,
      sourcePath,
    })

    // Then: no rewrite or credential material reaches the installed skill
    expect(second).toEqual({
      status: INSTALL_STATUS.unchanged,
      destination: first.destination,
    })
    expect(readFileSync(second.destination, 'utf8')).toBe(before)
    if (process.platform !== PLATFORM.Windows) {
      expect(statSync(second.destination).mode & 0o777).toBe(0o600)
    }
    expect(before).not.toContain(SECRET.first)
    expect(before).not.toContain(SECRET.second)
  })
})

function createSkillSource(): string {
  const sourceDirectory = join(directory, 'package', 'skills', SKILL.name)
  mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, SKILL.fileName)
  writeFileSync(sourcePath, SKILL.contents)
  return sourcePath
}

function restoreEnvironmentKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[ENVIRONMENT.key]
    return
  }
  process.env[ENVIRONMENT.key] = value
}
