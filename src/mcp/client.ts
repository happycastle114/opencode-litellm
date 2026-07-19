import { normalizeBaseURL } from '../utils/litellm-api'
import { isMcpServerName } from './options'

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
    if (endpoint.apiKey) headers.set('Authorization', `Bearer ${endpoint.apiKey}`)
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
  const standardKey =
    process.env.OPENCODE_LITELLM_API_KEY ??
    process.env.LITELLM_API_KEY ??
    process.env.LITELLM_MASTER_KEY
  if (standardKey !== undefined) return `Bearer ${standardKey}`
  if (configuredKey === undefined) return undefined

  const variableName = ENV_REFERENCE_PATTERN.exec(configuredKey)?.[1]
  const referencedKey = variableName === undefined ? undefined : process.env[variableName]
  return referencedKey === undefined ? undefined : `Bearer ${referencedKey}`
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
