import type { PluginOptions } from '@opencode-ai/plugin'

const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/
const TOOLSET_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const TOOLSET_OPTION_NAME = 'toolsets' as const
const DISCOVERY_FIELDS = new Set([
  'enabled',
  'include',
  'exclude',
  'servers',
  'timeoutMs',
  'requestTimeoutMs',
])
const SERVER_FIELDS = new Set(['serverName', 'enabled'])

export type McpServerOption = {
  readonly serverName: string
  readonly enabled?: boolean
}

export type McpDiscoveryOptions = {
  readonly enabled: boolean
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  readonly servers: readonly McpServerOption[]
  readonly timeoutMs: number
  readonly requestTimeoutMs: number
}

export type McpToolsetOptions = readonly string[]

export class McpDiscoveryConfigurationError extends Error {
  readonly name = 'McpDiscoveryConfigurationError'

  constructor(readonly field: string, message: string) {
    super(`Invalid mcpDiscovery option at ${field}: ${message}`)
  }
}

export class McpToolsetConfigurationError extends Error {
  readonly name = 'McpToolsetConfigurationError'

  constructor(readonly field: string, message: string) {
    super(`Invalid ${TOOLSET_OPTION_NAME} option at ${field}: ${message}`)
  }
}

export function parseMcpToolsetOptions(
  options: PluginOptions | undefined,
): McpToolsetOptions {
  const raw = options?.[TOOLSET_OPTION_NAME]
  if (raw === undefined) return []
  if (!Array.isArray(raw)) failToolset(TOOLSET_OPTION_NAME, 'expected an array')

  const names = raw.map((value, index) =>
    readToolsetName(value, `${TOOLSET_OPTION_NAME}[${index}]`),
  )
  rejectDuplicates(names, TOOLSET_OPTION_NAME, failToolset)
  return names
}

export const parseToolsetOptions = parseMcpToolsetOptions

export function parseMcpDiscoveryOptions(
  options: PluginOptions | undefined,
): McpDiscoveryOptions {
  const raw = options?.mcpDiscovery
  if (raw === undefined) return defaults()
  if (!isRecord(raw)) fail('mcpDiscovery', 'expected an object')
  rejectUnknownFields(raw, DISCOVERY_FIELDS, 'mcpDiscovery')

  return {
    enabled: readBoolean(raw.enabled, 'mcpDiscovery.enabled') ?? false,
    include: readNames(raw.include, 'mcpDiscovery.include'),
    exclude: readNames(raw.exclude, 'mcpDiscovery.exclude'),
    servers: readServers(raw.servers),
    timeoutMs: readInteger(raw.timeoutMs, 'mcpDiscovery.timeoutMs', 1, 5000) ?? 3000,
    requestTimeoutMs:
      readInteger(raw.requestTimeoutMs, 'mcpDiscovery.requestTimeoutMs', 1) ??
      15000,
  }
}

export function isMcpServerName(value: string): boolean {
  return SERVER_NAME_PATTERN.test(value)
}

function defaults(): McpDiscoveryOptions {
  return {
    enabled: false,
    include: [],
    exclude: [],
    servers: [],
    timeoutMs: 3000,
    requestTimeoutMs: 15000,
  }
}

function readNames(value: unknown, field: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(field, 'expected an array')
  const names = value.map((entry, index) => readName(entry, `${field}[${index}]`))
  rejectDuplicates(names, field)
  return names
}

function readServers(value: unknown): readonly McpServerOption[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('mcpDiscovery.servers', 'expected an array')
  const servers = value.map((entry, index) => {
    const field = `mcpDiscovery.servers[${index}]`
    if (!isRecord(entry)) fail(field, 'expected an object')
    rejectUnknownFields(entry, SERVER_FIELDS, field)
    const enabled = readBoolean(entry.enabled, `${field}.enabled`)
    return {
      serverName: readName(entry.serverName, `${field}.serverName`),
      ...(enabled === undefined ? {} : { enabled }),
    }
  })
  rejectDuplicates(
    servers.map((server) => server.serverName),
    'mcpDiscovery.servers',
  )
  return servers
}

function readName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isMcpServerName(value)) {
    fail(field, 'expected a lowercase name using letters, numbers, underscores, or hyphens')
  }
  return value
}

function readBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(field, 'expected a boolean')
  return value
}

function readInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum?: number,
): number | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    const range = maximum === undefined ? `at least ${minimum}` : `${minimum} through ${maximum}`
    fail(field, `expected an integer from ${range}`)
  }
  return value
}

function rejectDuplicates(
  values: readonly string[],
  field: string,
  failure: (field: string, message: string) => never = fail,
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) failure(field, `duplicate name "${value}"`)
    seen.add(value)
  }
}

function readToolsetName(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    failToolset(field, 'expected a non-empty printable string')
  }
  const name = value.trim()
  if (name === '' || TOOLSET_CONTROL_CHARACTER_PATTERN.test(name)) {
    failToolset(field, 'expected a non-empty printable string')
  }
  return name
}

function failToolset(field: string, message: string): never {
  throw new McpToolsetConfigurationError(field, message)
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key}`, 'unknown field')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(field: string, message: string): never {
  throw new McpDiscoveryConfigurationError(field, message)
}
