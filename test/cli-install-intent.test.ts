import { describe, expect, test } from 'bun:test'
import { resolveInstallIntent, ToolkitDefault } from '../src/cli/install-intent'

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
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: [],
      enableMcp: [],
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
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: [],
      enableMcp: [],
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
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: [],
      enableMcp: [],
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

  test.each(['LITELLM_BASE_URL', 'LITELLM_MASTER_KEY'] as const)(
    'rejects gateway-reserved environment %s',
    (authEnv) => {
      const result = resolveInstallIntent({
        target: 'opencode',
        baseUrl: 'https://litellm.example.com',
        auth: 'env',
        authEnv,
        nonInteractive: true,
        opencodeConfig: undefined,
        codexConfig: undefined,
        codexMode: 'both',
        autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
        search: [],
        mcp: [],
        toolsets: [],
        enableMcp: [],
        disableMcp: [],
        noSearch: false,
        noMcp: false,
        noToolsets: false,
      })

      expect(result).toEqual({
        ok: false,
        message: "'--auth-env' must be a valid environment variable name.",
      })
    },
  )

  test('rejects a slash in an explicit toolset name', () => {
    const result = resolveInstallIntent({
      target: 'opencode',
      baseUrl: 'https://litellm.example.com',
      auth: 'env',
      authEnv: 'LITELLM_API_KEY',
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode: 'both',
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: ['research/core'],
      enableMcp: [],
      disableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("without '/'")
  })
})
