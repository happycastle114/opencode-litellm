import { describe, expect, test } from 'bun:test'
import { parseCliArgs } from '../src/cli/command'
import { resolveInstallIntent } from '../src/cli/install-intent'

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
        disableMcp: [],
        noSearch: false,
        noMcp: false,
        noToolsets: false,
      },
    })
  })

  test('collects repeatable search, mcp, toolset, and disable-mcp options', () => {
    // Given: repeated search/mcp/toolset/disable-mcp flags
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
      '--disable-mcp',
      'minimax-search',
    ])

    // Then: each repeated flag accumulates in order
    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      search: ['agy-search', 'exa-search'],
      mcp: ['zread', 'zai-web-reader'],
      toolsets: ['research-core', 'ops-review'],
      disableMcp: ['minimax-search'],
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

describe('non-interactive install validation', () => {
  test('accepts sso auth when the non-interactive auth boundary is complete', () => {
    // Given: a non-interactive SSO request with a gateway and transient auth environment
    // When: the install intent is resolved
    const result = resolveInstallIntent({
      target: 'opencode',
      baseUrl: 'https://litellm.example.com',
      auth: 'sso',
      authEnv: 'LITELLM_PROXY_API_KEY',
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: 'both',
      search: [],
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    })

    // Then: the toolkit delegates SSO token handling instead of rejecting the intent
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.intent.opencode?.authEnv).toBe('LITELLM_PROXY_API_KEY')
  })

  test('requires base url and auth env when non-interactive', () => {
    // Given: a non-interactive request missing base url
    // When: resolved
    const result = resolveInstallIntent({
      target: 'opencode',
      baseUrl: undefined,
      auth: 'env',
      authEnv: undefined,
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: 'both',
      search: [],
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    })

    // Then: resolution reports the missing required inputs
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('--base-url')
  })

  test('resolves a valid non-interactive opencode intent', () => {
    // Given: a complete non-interactive request
    // When: resolved
    const result = resolveInstallIntent({
      target: 'opencode',
      baseUrl: 'https://litellm.example.com/',
      auth: 'env',
      authEnv: 'LITELLM_API_KEY',
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: 'both',
      search: [],
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    })

    // Then: an opencode intent with a normalized origin results
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.intent.opencode?.baseUrl).toBe('https://litellm.example.com')
    expect(result.intent.opencode?.authEnv).toBe('LITELLM_API_KEY')
  })
})
