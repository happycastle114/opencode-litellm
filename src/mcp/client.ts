import { normalizeBaseURL } from '../utils/litellm-api'
import { isMcpServerName } from './options'
import { resolveHeaderSafeApiKey } from '../utils/api-key'

const MCP_SERVERS_ENDPOINT = '/v1/mcp/server'
const ENV_REFERENCE_PATTERN = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/

export type McpDiscoveryEndpoint = {
  readonly baseURL: string
  readonly apiKey?: string
  readonly customHeaders?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

export class McpDiscoveryError extends Error {
  readonly name = 'McpDiscoveryError'
}

export async function discoverLiteLLMMcpServers(
  endpoint: McpDiscoveryEndpoint,
): Promise<readonly string[]> {
  let response: Response
  try {
    const headers = new Headers(endpoint.customHeaders)
    headers.set('Content-Type', 'application/json')
    const apiKey = resolveHeaderSafeApiKey(endpoint.apiKey)
    if (endpoint.apiKey !== undefined && apiKey === undefined) {
      throw new McpDiscoveryError('LiteLLM MCP server discovery requires a safe API key')
    }
    if (apiKey !== undefined) headers.set('Authorization', `Bearer ${apiKey}`)
    response = await fetch(
      `${normalizeBaseURL(endpoint.baseURL)}${MCP_SERVERS_ENDPOINT}`,
      {
        method: 'GET',
        headers,
        signal: AbortSignal.any([
          endpoint.signal,
          AbortSignal.timeout(endpoint.timeoutMs),
        ]),
      },
    )
  } catch (error) {
    if (error instanceof Error) {
      throw new McpDiscoveryError('LiteLLM MCP server discovery request failed')
    }
    throw error
  }

  if (!response.ok) {
    throw new McpDiscoveryError(
      `LiteLLM MCP server discovery responded with HTTP ${response.status}`,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    if (error instanceof Error) {
      throw new McpDiscoveryError('LiteLLM MCP server discovery returned malformed JSON')
    }
    throw error
  }
  return parseMcpServersResponse(raw)
}

export function parseMcpServersResponse(value: unknown): readonly string[] {
  const rows = readRows(value)
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row) || typeof row.server_name !== 'string') continue
    const name = row.server_name.trim()
    if (!isMcpServerName(name) || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function resolveMcpAuthorization(
  configuredKey?: string,
): string | undefined {
  if (configuredKey !== undefined) {
    const variableName = ENV_REFERENCE_PATTERN.exec(configuredKey)?.[1]
    if (variableName !== undefined) {
      const referencedKey = process.env[variableName]
      const key = resolveHeaderSafeApiKey(referencedKey)
      return key === undefined ? undefined : `Bearer ${key}`
    }
    if (configuredKey.includes('{') || configuredKey.includes('}')) return undefined
    const key = resolveHeaderSafeApiKey(configuredKey)
    return key === undefined ? undefined : `Bearer ${key}`
  }

  const standardKey =
    process.env.OPENCODE_LITELLM_API_KEY ??
    process.env.LITELLM_API_KEY ??
    process.env.LITELLM_MASTER_KEY
  const key = resolveHeaderSafeApiKey(standardKey)
  return key === undefined ? undefined : `Bearer ${key}`
}

function readRows(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []
  if (Array.isArray(value.data)) return value.data
  if (Array.isArray(value.mcp_servers)) return value.mcp_servers
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
