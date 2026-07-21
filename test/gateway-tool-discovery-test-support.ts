export const ENDPOINT = {
  Models: '/v1/models',
  McpServers: '/v1/mcp/server',
  SearchToolsAuthorized: '/search_tools/list',
  SearchToolsAvailable: '/v1/search/tools',
  Toolsets: '/v1/mcp/toolset',
} as const

export const ORIGIN = 'https://gateway.example.test'
export const API_KEY = 'gateway-tool-discovery-secret'
