import { describe, expect, test } from 'bun:test'
import { parseCliArgs } from '../src/cli/command'

describe('install argument parsing', () => {
  test('parses a full non-interactive opencode install invocation', () => {
    // Given: a fully specified non-interactive install command
    // When: the arguments are parsed
    const parsed = parseCliArgs([
      'install',
      '--target',
      'opencode',
      '--base-url',
      'https://litellm.example.com',
      '--auth',
      'env',
      '--auth-env',
      'LITELLM_API_KEY',
      '--non-interactive',
    ])

    // Then: a typed install invocation carries every option
    expect(parsed).toEqual({
      kind: 'command',
      command: 'install',
      help: false,
      options: {
        target: 'opencode',
        baseUrl: 'https://litellm.example.com',
        auth: 'env',
        authEnv: 'LITELLM_API_KEY',
        nonInteractive: true,
        opencodeConfig: undefined,
        codexConfig: undefined,
        codexMode: 'both',
        search: [],
        mcp: [],
        toolsets: [],
        enableMcp: [],
        disableMcp: [],
        noSearch: false,
        noMcp: false,
        noToolsets: false,
      },
    })
  })

  test('collects repeatable search, mcp, toolset, enable-mcp, and disable-mcp options', () => {
    // Given: repeated discovery and MCP state flags
    // When: parsed
    const parsed = parseCliArgs([
      'install',
      '--target',
      'opencode',
      '--search',
      'agy-search',
      '--search',
      'exa-search',
      '--mcp',
      'zread',
      '--mcp',
      'zai-web-reader',
      '--toolset',
      'research-core',
      '--toolset',
      'ops-review',
      '--enable-mcp',
      'minimax_search',
      '--enable-mcp',
      'zread',
      '--disable-mcp',
      'zai_web_reader',
    ])

    // Then: each repeated flag accumulates in order
    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      search: ['agy-search', 'exa-search'],
      mcp: ['zread', 'zai-web-reader'],
      toolsets: ['research-core', 'ops-review'],
      enableMcp: ['minimax_search', 'zread'],
      disableMcp: ['zai_web_reader'],
    })
  })

  test('records --no-search, --no-mcp, and --no-toolsets toggles', () => {
    // Given: opt-out toggles
    // When: parsed
    const parsed = parseCliArgs([
      'install', '--target', 'opencode', '--no-search', '--no-mcp', '--no-toolsets',
    ])

    // Then: the toggles are captured
    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({ noSearch: true, noMcp: true, noToolsets: true })
  })

  test('captures --opencode-config path override', () => {
    // Given: an explicit config path
    // When: parsed
    const parsed = parseCliArgs([
      'install',
      '--target',
      'opencode',
      '--opencode-config',
      '/tmp/opencode.jsonc',
    ])

    // Then: the path is recorded
    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options.opencodeConfig).toBe('/tmp/opencode.jsonc')
  })

  test('captures --codex-config path override', () => {
    const parsed = parseCliArgs([
      'install',
      '--target',
      'codex',
      '--codex-config',
      '/tmp/codex/config.toml',
    ])

    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options.codexConfig).toBe('/tmp/codex/config.toml')
  })

  test('uses production gateway, auth environment, discovery, and Codex mode defaults', () => {
    const parsed = parseCliArgs(['install'])

    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      baseUrl: 'https://llm.soungmin.kr',
      auth: 'sso',
      authEnv: 'LITELLM_PROXY_API_KEY',
      codexMode: 'both',
      search: [],
      toolsets: [],
    })
  })

  test('uses LiteLLM environment defaults for the exact non-interactive npx surface', () => {
    const parsed = parseCliArgs(['install', '--non-interactive'], {
      LITELLM_BASE_URL: 'https://fixture.litellm.test',
      LITELLM_PROXY_API_KEY: 'fixture-key',
    })

    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      baseUrl: 'https://fixture.litellm.test',
      auth: 'env',
      authEnv: 'LITELLM_PROXY_API_KEY',
      nonInteractive: true,
    })
  })

  test('keeps explicit SSO and gateway options ahead of environment defaults', () => {
    const parsed = parseCliArgs([
      'install',
      '--base-url',
      'https://explicit.litellm.test',
      '--auth',
      'sso',
    ], {
      LITELLM_BASE_URL: 'https://fixture.litellm.test',
      LITELLM_PROXY_API_KEY: 'fixture-key',
    })

    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      baseUrl: 'https://explicit.litellm.test',
      auth: 'sso',
    })
  })

  test.each(['gateway', 'oauth', 'both'] as const)(
    'parses --codex-mode %s as a typed choice',
    (codexMode) => {
      const parsed = parseCliArgs(['install', '--target', 'codex', '--codex-mode', codexMode])

      expect(parsed.kind).toBe('command')
      if (parsed.kind !== 'command') return
      expect(parsed.options.codexMode).toBe(codexMode)
    },
  )

  test.each([
    [['install', '--target'], "Option '--target' requires a value."],
    [['install', '--target', 'invalid'], "Invalid value 'invalid' for '--target'."],
    [['install', '--auth', 'invalid'], "Invalid value 'invalid' for '--auth'."],
    [['install', '--codex-mode', 'invalid'], "Invalid value 'invalid' for '--codex-mode'."],
    [['install', '--base-url'], "Option '--base-url' requires a value."],
    [['install', '--unknown'], "Unknown option '--unknown' for command 'install'."],
  ])('produces a deterministic parse error for %j', (argv, message) => {
    // Given: malformed install arguments
    // When: parsed
    const parsed = parseCliArgs(argv)

    // Then: a concise error value results
    expect(parsed).toEqual({ kind: 'error', message })
  })

  test('still recognizes install help', () => {
    // Given: install with help
    // When: parsed
    const parsed = parseCliArgs(['install', '--help'])

    // Then: help is preserved
    expect(parsed).toEqual({ kind: 'command', command: 'install', help: true, options: undefined })
  })
})
