export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/
const TOOLSET_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export type OpenCodeToolName = string & {
  readonly __openCodeToolName: unique symbol
}

export type McpToolsetName = string & {
  readonly __mcpToolsetName: unique symbol
}

export function isValidToolName(value: string): value is OpenCodeToolName {
  return TOOL_NAME_PATTERN.test(value)
}

export function isValidToolsetName(value: string): value is McpToolsetName {
  const normalized = value.trim()
  return normalized !== '' &&
    !TOOLSET_CONTROL_CHARACTER_PATTERN.test(normalized) &&
    !normalized.includes('/')
}
