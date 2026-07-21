const MCP_PATH = 'mcp' as const

export function mcpServerEndpoint(origin: string, serverName: string): string {
  return `${origin}/${encodeURIComponent(serverName)}/${MCP_PATH}`
}

export function mcpToolsetEndpoint(origin: string, toolsetName: string): string {
  return `${origin}/${MCP_PATH}/${encodeURIComponent(toolsetName)}`
}
