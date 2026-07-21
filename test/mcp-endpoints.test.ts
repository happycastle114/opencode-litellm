import { describe, expect, test } from 'bun:test'
import { mcpServerEndpoint, mcpToolsetEndpoint } from '../src/mcp/endpoints'

describe('LiteLLM v1.94.0-rc.1 MCP endpoint contract', () => {
  test('uses the pinned toolset route from commit 5d4c4d0f', () => {
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
