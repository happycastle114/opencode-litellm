import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHARED_SKILL = {
  name: 'litellm-research-router',
  fileName: 'SKILL.md',
  relativePath: ['..', 'skills', 'litellm-research-router', 'SKILL.md'] as const,
  repositoryRelativePath: [
    '..',
    '..',
    'skills',
    'litellm-research-router',
    'SKILL.md',
  ] as const,
  sourceRelativePath: [
    '..',
    'src',
    'skills',
    'litellm-research-router',
    'SKILL.md',
  ] as const,
} as const

const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export const SHARED_LITELLM_SKILL_NAME = SHARED_SKILL.name
export const SHARED_LITELLM_SKILL_FILE_NAME = SHARED_SKILL.fileName

export type OpenCodeSkillInstallOptions = {
  readonly homeDirectory: string
  readonly skillName?: string
  readonly sourcePath?: string
}

export type OpenCodeSkillInstallResult = {
  readonly status: 'installed' | 'unchanged'
  readonly destination: string
}

export function installOpenCodeSkill(
  options: OpenCodeSkillInstallOptions,
): OpenCodeSkillInstallResult {
  const skillName = options.skillName ?? SHARED_SKILL.name
  if (!SKILL_NAME_PATTERN.test(skillName)) {
    throw new Error('Skill name must contain only lowercase letters, numbers, dots, underscores, or hyphens.')
  }
  const sourcePath = options.sourcePath ?? resolvePackagedSkillSourcePath()
  const destination = join(
    options.homeDirectory,
    '.agents',
    'skills',
    skillName,
    SHARED_SKILL.fileName,
  )
  const contents = readFileSync(sourcePath)
  mkdirSync(dirname(destination), { recursive: true, mode: DIRECTORY_MODE })

  if (existsSync(destination) && readFileSync(destination).equals(contents)) {
    return { status: 'unchanged', destination }
  }

  const temporary = `${destination}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, contents, { mode: FILE_MODE })
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
  chmodSync(destination, FILE_MODE)
  return { status: 'installed', destination }
}

export function resolvePackagedSkillSourcePath(
  moduleURL: string = import.meta.url,
): string {
  const candidates = [
    fileURLToPath(new URL(`${SHARED_SKILL.relativePath.join('/')}`, moduleURL)),
    fileURLToPath(
      new URL(`${SHARED_SKILL.repositoryRelativePath.join('/')}`, moduleURL),
    ),
    fileURLToPath(
      new URL(`${SHARED_SKILL.sourceRelativePath.join('/')}`, moduleURL),
    ),
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (source === undefined) {
    throw new Error('Packaged LiteLLM research-router skill is missing.')
  }
  return source
}
