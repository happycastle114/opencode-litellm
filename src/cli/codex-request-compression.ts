import { Buffer } from 'node:buffer'
import { parse as parseToml } from 'smol-toml'

export const CODEX_FEATURE_KEY = {
  EnableRequestCompression: 'enable_request_compression',
} as const

const CODEX_TOML_TABLE = {
  Features: 'features',
} as const
const MANAGED_BLOCK = {
  Start: '# BEGIN opencode-litellm-oauth-request-compression',
  End: '# END opencode-litellm-oauth-request-compression',
  OriginalLine: '# original-line-base64:',
} as const
const REQUEST_COMPRESSION = {
  Enabled: false,
} as const
const FEATURE_TABLE_HEADER = new RegExp(
  `^\\s*\\[\\s*${tomlKeyPattern(CODEX_TOML_TABLE.Features)}\\s*\\]\\s*(?:#.*)?$`,
)
const FEATURE_ASSIGNMENT = new RegExp(
  `^\\s*${tomlKeyPattern(CODEX_FEATURE_KEY.EnableRequestCompression)}\\s*=`,
)
const DOTTED_FEATURE_ASSIGNMENT = new RegExp(
  `^\\s*${tomlKeyPattern(CODEX_TOML_TABLE.Features)}\\s*\\.\\s*${tomlKeyPattern(CODEX_FEATURE_KEY.EnableRequestCompression)}\\s*=`,
)
const INLINE_FEATURE_ASSIGNMENT = new RegExp(
  `^\\s*${tomlKeyPattern(CODEX_TOML_TABLE.Features)}\\s*=`,
)
const MANAGED_BLOCK_PATTERN = new RegExp(
  `${escapeRegex(MANAGED_BLOCK.Start)}\\r?\\n([\\s\\S]*?)\\r?\\n${escapeRegex(MANAGED_BLOCK.End)}[\\t ]*(?:\\r?\\n)?`,
  'g',
)

class CodexRequestCompressionConfigError extends Error {
  readonly name = 'CodexRequestCompressionConfigError'
}

type TomlLineRange = {
  readonly start: number
  readonly end: number
}

export function manageCodexOAuthRequestCompression(source: string): string {
  const restored = restoreCodexRequestCompressionPreference(source)
  const parsed = parseToml(restored)
  const lines = restored.trimEnd().split(/\r?\n/)
  const tableStart = lines.findIndex((line) => FEATURE_TABLE_HEADER.test(line))

  if (tableStart >= 0) {
    const tableEnd = findTableEnd(lines, tableStart)
    const assignmentIndex = findAssignment(
      lines,
      { start: tableStart + 1, end: tableEnd },
      FEATURE_ASSIGNMENT,
    )
    const block = renderManagedBlock(
      assignmentIndex === undefined ? undefined : lines[assignmentIndex],
      CODEX_FEATURE_KEY.EnableRequestCompression,
    )
    if (assignmentIndex === undefined) lines.splice(tableStart + 1, 0, ...block)
    else lines.splice(assignmentIndex, 1, ...block)
    return validateCandidate(lines.join('\n'))
  }

  if (hasFeatureTable(parsed)) {
    const firstTable = lines.findIndex((line) => line.trimStart().startsWith('['))
    const rootEnd = firstTable < 0 ? lines.length : firstTable
    const rootRange = { start: 0, end: rootEnd }
    const assignmentIndex = findAssignment(lines, rootRange, DOTTED_FEATURE_ASSIGNMENT)
    if (assignmentIndex !== undefined) {
      lines.splice(assignmentIndex, 1, ...renderManagedBlock(
        lines[assignmentIndex],
        `${CODEX_TOML_TABLE.Features}.${CODEX_FEATURE_KEY.EnableRequestCompression}`,
      ))
      return validateCandidate(lines.join('\n'))
    }
    if (findAssignment(lines, rootRange, INLINE_FEATURE_ASSIGNMENT) !== undefined) {
      throw new CodexRequestCompressionConfigError(
        'Codex OAuth request compression cannot be managed inside an inline features table.',
      )
    }
    lines.splice(rootEnd, 0, ...renderManagedBlock(
      undefined,
      `${CODEX_TOML_TABLE.Features}.${CODEX_FEATURE_KEY.EnableRequestCompression}`,
    ))
    return validateCandidate(lines.join('\n'))
  }

  const block = renderManagedBlock(
    undefined,
    CODEX_FEATURE_KEY.EnableRequestCompression,
    `[${CODEX_TOML_TABLE.Features}]`,
  )
  return validateCandidate([...lines, '', ...block].join('\n'))
}

export function restoreCodexRequestCompressionPreference(source: string): string {
  parseToml(source)
  const restored = source.replace(
    MANAGED_BLOCK_PATTERN,
    (_block, body: string) => restoreOriginalLine(body),
  ).trim()
  parseToml(restored)
  return restored
}

function renderManagedBlock(
  originalLine: string | undefined,
  assignmentKey: string,
  tableHeader?: string,
): readonly string[] {
  return [
    MANAGED_BLOCK.Start,
    ...(tableHeader === undefined ? [] : [tableHeader]),
    ...(originalLine === undefined
      ? []
      : [`${MANAGED_BLOCK.OriginalLine} ${Buffer.from(originalLine, 'utf8').toString('base64')}`]),
    `${assignmentKey} = ${String(REQUEST_COMPRESSION.Enabled)}`,
    MANAGED_BLOCK.End,
  ]
}

function restoreOriginalLine(body: string): string {
  const metadata = body
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${MANAGED_BLOCK.OriginalLine} `))
  if (metadata === undefined) return ''
  const encoded = metadata.slice(MANAGED_BLOCK.OriginalLine.length + 1)
  const original = Buffer.from(encoded, 'base64').toString('utf8')
  if (!FEATURE_ASSIGNMENT.test(original) && !DOTTED_FEATURE_ASSIGNMENT.test(original)) {
    throw new CodexRequestCompressionConfigError(
      'Codex OAuth request compression metadata does not contain a feature assignment.',
    )
  }
  return `${original}\n`
}

function hasFeatureTable(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    Object.hasOwn(value, CODEX_TOML_TABLE.Features)
}

function findTableEnd(lines: readonly string[], tableStart: number): number {
  const relativeEnd = lines
    .slice(tableStart + 1)
    .findIndex((line) => line.trimStart().startsWith('['))
  return relativeEnd < 0 ? lines.length : tableStart + 1 + relativeEnd
}

function findAssignment(
  lines: readonly string[],
  range: TomlLineRange,
  pattern: RegExp,
): number | undefined {
  const relativeIndex = lines
    .slice(range.start, range.end)
    .findIndex((line) => pattern.test(line))
  return relativeIndex < 0 ? undefined : range.start + relativeIndex
}

function validateCandidate(value: string): string {
  const output = `${value.trim()}\n`
  parseToml(output)
  return output
}

function tomlKeyPattern(value: string): string {
  const escaped = escapeRegex(value)
  return `(?:${escaped}|"${escaped}"|'${escaped}')`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
