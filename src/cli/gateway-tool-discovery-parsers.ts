import {
  ENDPOINT,
  RESPONSE_FIELD,
  RESPONSE_OBJECT,
  OPTIONAL_FAILURE_KIND,
  OptionalEndpointFailure,
  type GatewayToolset,
  type OptionalEndpoint,
} from './gateway-tool-discovery-contracts'
import {
  isValidToolName,
  isValidToolsetName,
} from '../utils/tool-name-validation'

export function readAuthorizedSearchToolNames(payload: unknown): readonly string[] {
  if (!isRecord(payload)) throw invalidShape(ENDPOINT.SearchToolsAuthorized)
  const rows = payload[RESPONSE_FIELD.SearchTools]
  if (!Array.isArray(rows)) throw invalidShape(ENDPOINT.SearchToolsAuthorized)

  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) throw invalidShape(ENDPOINT.SearchToolsAuthorized)
    const rawName = row[RESPONSE_FIELD.SearchToolName]
    if (typeof rawName !== 'string' || !isValidToolName(rawName)) {
      throw invalidShape(ENDPOINT.SearchToolsAuthorized)
    }
    const name = rawName
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.sort()
}

export function readAvailableSearchToolNames(payload: unknown): readonly string[] {
  if (!isRecord(payload)) throw invalidShape(ENDPOINT.SearchToolsAvailable)
  if (payload[RESPONSE_FIELD.Object] !== RESPONSE_OBJECT.List) {
    throw invalidShape(ENDPOINT.SearchToolsAvailable)
  }
  const rows = payload[RESPONSE_FIELD.Data]
  if (!Array.isArray(rows)) throw invalidShape(ENDPOINT.SearchToolsAvailable)

  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) throw invalidShape(ENDPOINT.SearchToolsAvailable)
    const rawName = row[RESPONSE_FIELD.SearchToolName]
    if (typeof rawName !== 'string' || !isValidToolName(rawName)) {
      throw invalidShape(ENDPOINT.SearchToolsAvailable)
    }
    const name = rawName
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.sort()
}

export function readToolsets(payload: unknown): readonly GatewayToolset[] {
  if (!Array.isArray(payload)) throw invalidShape(ENDPOINT.Toolsets)

  const toolsets: GatewayToolset[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const row of payload) {
    if (!isRecord(row)) throw invalidShape(ENDPOINT.Toolsets)
    const toolsetId = readNonEmptyString(row[RESPONSE_FIELD.ToolsetId])
    const toolsetName = readNonEmptyString(row[RESPONSE_FIELD.ToolsetName])
    if (
      toolsetId === undefined ||
      toolsetName === undefined ||
      !isValidToolsetName(toolsetName)
    ) {
      throw invalidShape(ENDPOINT.Toolsets)
    }
    if (seenIds.has(toolsetId) || seenNames.has(toolsetName)) continue
    seenIds.add(toolsetId)
    seenNames.add(toolsetName)
    toolsets.push({ toolsetId, toolsetName })
  }
  return toolsets
}

export function invalidShape(endpoint: OptionalEndpoint): OptionalEndpointFailure {
  return new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.InvalidShape)
}

export function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
