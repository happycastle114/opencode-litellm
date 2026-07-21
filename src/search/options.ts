import type { PluginOptions } from '@opencode-ai/plugin'
import { isValidToolName } from '../utils/tool-name-validation'

export type LiteLLMSearchToolOption = {
  readonly toolName: string
  readonly searchToolName: string
  readonly description?: string
  readonly defaultMaxResults?: number
}

const RESERVED_TOOL_NAME = 'websearch'
const SEARCH_TOOL_FIELDS = new Set([
  'toolName',
  'searchToolName',
  'description',
  'defaultMaxResults',
])

export type LiteLLMPluginOptions = {
  readonly searchTools?: readonly LiteLLMSearchToolOption[]
}

export class SearchToolConfigurationError extends Error {
  readonly name = 'SearchToolConfigurationError'

  constructor(readonly field: string, message: string) {
    super(`Invalid searchTools option at ${field}: ${message}`)
  }
}

export function parseSearchToolOptions(
  options: PluginOptions | undefined,
): readonly LiteLLMSearchToolOption[] {
  if (options === undefined || options.searchTools === undefined) return []
  if (!Array.isArray(options.searchTools)) {
    throw new SearchToolConfigurationError('searchTools', 'expected an array')
  }

  const names = new Set<string>()
  return options.searchTools.map((raw, index) => {
    const field = `searchTools[${index}]`
    if (!isRecord(raw)) {
      throw new SearchToolConfigurationError(field, 'expected an object')
    }
    rejectUnknownFields(raw, field)

    const toolName = readName(raw.toolName, `${field}.toolName`)
    if (toolName === RESERVED_TOOL_NAME) {
      throw new SearchToolConfigurationError(
        `${field}.toolName`,
        `name "${RESERVED_TOOL_NAME}" is reserved by OpenCode`,
      )
    }
    const searchToolName = readName(
      raw.searchToolName,
      `${field}.searchToolName`,
    )
    if (names.has(toolName)) {
      throw new SearchToolConfigurationError(
        `${field}.toolName`,
        `duplicate name "${toolName}"`,
      )
    }
    names.add(toolName)

    const description = readOptionalDescription(raw.description, field)
    const defaultMaxResults = readOptionalMaxResults(
      raw.defaultMaxResults,
      field,
    )
    return {
      toolName,
      searchToolName,
      ...(description === undefined ? {} : { description }),
      ...(defaultMaxResults === undefined ? {} : { defaultMaxResults }),
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isValidToolName(value)) {
    throw new SearchToolConfigurationError(
      field,
      'expected a lowercase name using letters, numbers, underscores, or hyphens',
    )
  }
  return value
}

function readOptionalDescription(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SearchToolConfigurationError(
      `${field}.description`,
      'expected a non-empty string',
    )
  }
  return value.trim()
}

function readOptionalMaxResults(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20) {
    throw new SearchToolConfigurationError(
      `${field}.defaultMaxResults`,
      'expected an integer from 1 through 20',
    )
  }
  return value
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  field: string,
): void {
  for (const name of Object.keys(value)) {
    if (!SEARCH_TOOL_FIELDS.has(name)) {
      throw new SearchToolConfigurationError(`${field}.${name}`, 'unknown field')
    }
  }
}
