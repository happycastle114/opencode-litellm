import type { PluginOptions } from '@opencode-ai/plugin'

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

export type LiteLLMSearchToolOption = {
  readonly toolName: string
  readonly searchToolName: string
  readonly description?: string
  readonly defaultMaxResults?: number
  readonly overrideBuiltin?: boolean
}

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

    const toolName = readName(raw.toolName, `${field}.toolName`)
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
    const overrideBuiltin = readOptionalBoolean(
      raw.overrideBuiltin,
      `${field}.overrideBuiltin`,
    )
    if (toolName === 'websearch' && overrideBuiltin !== true) {
      throw new SearchToolConfigurationError(
        `${field}.overrideBuiltin`,
        'must be true when toolName is "websearch"',
      )
    }

    return {
      toolName,
      searchToolName,
      ...(description === undefined ? {} : { description }),
      ...(defaultMaxResults === undefined ? {} : { defaultMaxResults }),
      ...(overrideBuiltin === undefined ? {} : { overrideBuiltin }),
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !TOOL_NAME_PATTERN.test(value)) {
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

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new SearchToolConfigurationError(field, 'expected a boolean')
  }
  return value
}
