import { describe, expect, test } from 'bun:test'
import { parse as parseToml } from 'smol-toml'
import {
  buildCodexCatalog,
  renderCodexConfig,
  renderCodexOAuthConfig,
} from '../src/cli/codex-config'

const intent = {
  baseUrl: 'https://litellm.example.com',
  authEnv: 'LITELLM_API_KEY',
  catalogPath: '/home/test/.codex/litellm-models.json',
  defaultModel: 'coding-fast',
  mcp: ['zread', 'zai_web_reader', 'minimax_search'],
  toolsets: ['research docs', 'team/alpha', 'team-alpha'],
  disableMcp: ['minimax_search'],
} as const

describe('Codex managed configuration', () => {
  test('preserves unmanaged TOML and emits the provider contract', () => {
    // Given: existing unrelated Codex settings
    const source = 'approval_policy = "on-request"\n\n[features]\nmulti_agent = true\n'

    // When: the managed LiteLLM block is rendered
    const output = renderCodexConfig(source, intent)
    const parsed = parseToml(output)

    // Then: unrelated settings survive and the provider uses env references
    expect(parsed.approval_policy).toBe('on-request')
    expect(parsed.features).toEqual({ multi_agent: true })
    expect(parsed.model).toBe('coding-fast')
    expect(parsed.model_provider).toBe('litellm')
    expect(parsed.model_catalog_json).toBe(intent.catalogPath)
    expect(parsed.model_providers.litellm.wire_api).toBe('responses')
    expect(parsed.model_providers.litellm.env_key).toBe('LITELLM_API_KEY')
    expect(output).not.toContain('sk-')
  })

  test('is idempotent and replaces only its managed block', () => {
    // Given: a config rendered once
    const once = renderCodexConfig('', intent)

    // When: rendered again
    const twice = renderCodexConfig(once, intent)

    // Then: the bytes are identical and one managed block remains
    expect(twice).toBe(once)
    expect(twice.match(/BEGIN opencode-litellm/g)).toHaveLength(1)
  })

  test('rejects malformed existing TOML before writing', () => {
    // Given: invalid existing TOML
    // When/Then: rendering fails before producing a candidate
    expect(() => renderCodexConfig('[broken', intent)).toThrow()
  })

  test('renders selected LiteLLM toolsets with encoded URLs and safe IDs', () => {
    // Given: authorized toolsets whose display names contain URL and TOML delimiters
    const output = renderCodexConfig('', intent)
    const servers = parseToml(output).mcp_servers

    // When: Codex reads the managed MCP tables
    // Then: each toolset uses a stable safe ID, an encoded gateway path, and env-backed auth
    expect(servers.litellm_toolset_research_docs.url).toBe(
      `${intent.baseUrl}/toolset/research%20docs/mcp`,
    )
    expect(servers.litellm_toolset_research_docs.bearer_token_env_var).toBe(intent.authEnv)
    expect(servers.litellm_toolset_team_alpha.url).toBe(
      `${intent.baseUrl}/toolset/team%2Falpha/mcp`,
    )
    expect(servers.litellm_toolset_team_alpha_2.url).toBe(
      `${intent.baseUrl}/toolset/team-alpha/mcp`,
    )
    expect(output).not.toContain('sk-')
  })

  test('renders OAuth-only MCP servers and toolsets with env-backed admission auth', () => {
    // Given: an OAuth profile with separately selected MCP resources
    const oauthIntent = {
      baseUrl: intent.baseUrl,
      authEnv: intent.authEnv,
      catalogPath: '/home/test/.codex/litellm-codex-oauth-models.json',
      defaultModel: intent.defaultModel,
      mcp: ['research_docs'],
      disableMcp: ['research_docs'],
      toolsets: ['research docs'],
    } as const

    // When: the OAuth-only Codex config is rendered twice
    const once = renderCodexOAuthConfig(oauthIntent)
    const twice = renderCodexOAuthConfig(once, oauthIntent)
    const parsed = parseToml(once)
    const servers = parsed.mcp_servers
    const provider = parsed.model_providers['litellm-codex-oauth']

    // Then: OAuth owns Authorization, while MCP admission uses only the env reference and remains idempotent
    expect(parsed.model_provider).toBe('litellm-codex-oauth')
    expect(provider.requires_openai_auth).toBe(true)
    expect(provider.auth).toBeUndefined()
    expect(provider.env_key).toBeUndefined()
    expect(servers.litellm_research_docs.enabled).toBe(false)
    expect(servers.litellm_research_docs.bearer_token_env_var).toBe(intent.authEnv)
    expect(servers.litellm_toolset_research_docs.url).toBe(
      `${intent.baseUrl}/toolset/research%20docs/mcp`,
    )
    expect(servers.litellm_toolset_research_docs.bearer_token_env_var).toBe(intent.authEnv)
    expect(twice).toBe(once)
    expect(once).not.toContain('sk-')
  })
})

describe('Codex model catalog', () => {
  test('generates visible Codex models and chooses coding-fast first', () => {
    // Given: authenticated LiteLLM model discovery data
    const catalog = buildCodexCatalog([
      { id: 'coding-strong', object: 'model' },
      { id: 'coding-fast', object: 'model' },
    ])

    // When: the catalog is serialized
    const payload = JSON.parse(catalog.json)

    // Then: all models are visible and coding-fast is selected by policy
    expect(catalog.defaultModel).toBe('coding-fast')
    expect(payload.models.map((model: { slug: string }) => model.slug)).toEqual([
      'coding-fast', 'coding-strong',
    ])
    expect(payload.models.every((model: { visibility: string }) => model.visibility === 'list')).toBe(true)
  })
})
