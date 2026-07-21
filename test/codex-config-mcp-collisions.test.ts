import { describe, expect, test } from 'bun:test'
import { parse as parseToml } from 'smol-toml'
import { renderCodexConfig } from '../src/cli/codex-config'

const BASE = 'https://litellm.example.com'
const AUTH_ENV = 'LITELLM_API_KEY'

function render(mcp: readonly string[], toolsets: readonly string[] = []): string {
  return renderCodexConfig('', {
    baseUrl: BASE,
    authEnv: AUTH_ENV,
    catalogPath: '/tmp/litellm-models.json',
    defaultModel: 'coding-fast',
    mcp,
    toolsets,
    disableMcp: [],
  })
}

describe('Codex MCP collision-safe rendering', () => {
  test('keeps hyphen and underscore servers on distinct stable TOML tables', () => {
    const once = render(['foo_bar', 'foo-bar'])
    const twice = renderCodexConfig(once, {
      baseUrl: BASE,
      authEnv: AUTH_ENV,
      catalogPath: '/tmp/litellm-models.json',
      defaultModel: 'coding-fast',
      mcp: ['foo-bar', 'foo_bar'],
      toolsets: [],
      disableMcp: [],
    })
    const servers = parseToml(once).mcp_servers

    expect(servers.litellm_foo_bar.url).toBe(`${BASE}/foo-bar/mcp`)
    expect(servers.litellm_foo_bar_2.url).toBe(`${BASE}/foo_bar/mcp`)
    expect(twice).toBe(once)
  })

  test('reserves server IDs and global toolset suffixes', () => {
    const once = render(['toolset-foo'], ['foo', 'foo!', 'foo-2'])
    const reversed = render(['toolset-foo'], ['foo-2', 'foo!', 'foo'])
    const servers = parseToml(once).mcp_servers

    expect(reversed).toBe(once)
    expect(Object.values(servers).map((entry) => entry.url)).toEqual(expect.arrayContaining([
      `${BASE}/toolset/foo-2/mcp`,
      `${BASE}/toolset/foo!/mcp`,
      `${BASE}/toolset/foo/mcp`,
      `${BASE}/toolset-foo/mcp`,
    ]))
    expect(Object.keys(servers)).toHaveLength(4)
  })

  test('reserves unmanaged tables and remains idempotent', () => {
    const source = '[mcp_servers.litellm_foo]\nurl = "https://user.test/mcp"\n'
    const intent = {
      baseUrl: BASE,
      authEnv: AUTH_ENV,
      catalogPath: '/tmp/litellm-models.json',
      defaultModel: 'coding-fast',
      mcp: ['foo'],
      toolsets: [],
      disableMcp: [],
    } as const
    const once = renderCodexConfig(source, intent)
    const twice = renderCodexConfig(once, intent)
    const servers = parseToml(once).mcp_servers

    expect(servers.litellm_foo.url).toBe('https://user.test/mcp')
    expect(servers.litellm_foo_2.url).toBe(`${BASE}/foo/mcp`)
    expect(twice).toBe(once)
  })
})
