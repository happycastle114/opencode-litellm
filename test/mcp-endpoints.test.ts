import { describe, expect, test } from 'bun:test'
import { mcpServerEndpoint, mcpToolsetEndpoint } from '../src/mcp/endpoints'

describe('deployed LiteLLM MCP endpoint compatibility contract', () => {
  test('uses the configured toolset compatibility route', () => {
    expect(mcpToolsetEndpoint('https://litellm.example.com', 'research/core')).toBe(
      'https://litellm.example.com/toolset/research%2Fcore/mcp',
    )
  })

  test('keeps deployed MCP server compatibility routes unchanged', () => {
    expect(mcpServerEndpoint('https://litellm.example.com', 'zread')).toBe(
      'https://litellm.example.com/zread/mcp',
    )
  })
})
