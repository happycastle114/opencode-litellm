import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse as parseToml } from 'smol-toml'
import {
  buildCodexCatalog,
  renderCodexConfig,
  renderCodexOAuthConfig,
} from '../src/cli/codex-config'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import { QWEN_GATEWAY_MODEL } from '../src/cli/qwen-routing'

const bundledCatalog = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})

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

  test('transitions an OAuth main config to gateway without losing user settings', () => {
    const oauthIntent = {
      baseUrl: intent.baseUrl,
      authEnv: intent.authEnv,
      catalogPath: '/home/test/.codex/litellm-codex-oauth-models.json',
      defaultModel: intent.defaultModel,
      mcp: intent.mcp,
      disableMcp: intent.disableMcp,
      toolsets: intent.toolsets,
    } as const
    const oauthSource = renderCodexOAuthConfig(
      'approval_policy = "on-request"\ncustom_root = "keep"\n\n[features]\nmulti_agent = true\n',
      oauthIntent,
    )

    const gatewayIntent = {
      ...intent,
      authCommand: '/home/test/.codex/libexec/litellm-auth-token.mjs',
    } as const
    const once = renderCodexConfig(oauthSource, gatewayIntent)
    const twice = renderCodexConfig(once, gatewayIntent)
    const parsed = parseToml(once)

    expect(parsed.forced_login_method).toBeUndefined()
    expect(parsed.model).toBe(intent.defaultModel)
    expect(parsed.model_provider).toBe('litellm-gateway-sso')
    expect(parsed.custom_root).toBe('keep')
    expect(parsed.approval_policy).toBe('on-request')
    expect(parsed.features).toEqual({ multi_agent: true })
    expect(twice).toBe(once)
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
      `${intent.baseUrl}/toolset/team-alpha/mcp`,
    )
    expect(servers.litellm_toolset_team_alpha_2.url).toBe(
      `${intent.baseUrl}/toolset/team%2Falpha/mcp`,
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
    expect(parsed.forced_login_method).toBe('chatgpt')
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
    ], bundledCatalog.template)

    // When: the catalog is serialized
    const payload = JSON.parse(catalog.json)

    // Then: all models are visible and coding-fast is selected by policy
    expect(catalog.defaultModel).toBe('coding-fast')
    expect(payload.models.map((model: { slug: string }) => model.slug)).toEqual([
      'coding-fast', 'coding-strong',
    ])
    expect(payload.models.every((model: { visibility: string }) => model.visibility === 'list')).toBe(true)
  })

  test('orders coding-fast before discovered Qwen using Codex ascending priority', () => {
    const catalog = buildCodexCatalog([
      { id: QWEN_GATEWAY_MODEL, object: 'model' },
      { id: 'coding-fast', object: 'model' },
    ], bundledCatalog.template)
    const payload = JSON.parse(catalog.json)
    const qwen = payload.models.find((model: { slug: string }) => model.slug === QWEN_GATEWAY_MODEL)
    const codingFast = payload.models.find((model: { slug: string }) => model.slug === 'coding-fast')

    expect(catalog.defaultModel).toBe('coding-fast')
    expect(qwen.priority).toBe(100)
    expect(codingFast.priority).toBe(1)
  })

  test('enriches the verified Qwen preview with Codex capability metadata', () => {
    // Given: the exact Qwen preview route is returned by LiteLLM discovery
    const catalog = buildCodexCatalog(
      [{ id: QWEN_GATEWAY_MODEL, object: 'model' }],
      bundledCatalog.template,
    )

    // When: Codex consumes the generated catalog row
    const payload = JSON.parse(catalog.json)
    const qwen = payload.models[0]

    // Then: the row exposes only capabilities verified for this route and supported by Codex
    expect(qwen).toMatchObject({
      slug: QWEN_GATEWAY_MODEL,
      display_name: 'Qwen3.8 Max Preview',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [],
      supports_parallel_tool_calls: false,
      supports_search_tool: false,
      supports_image_detail_original: false,
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      input_modalities: ['text', 'image'],
      priority: 1,
    })
  })

  test('inherits prompt behavior while keeping gateway capabilities conservative', () => {
    // Given: a discovered route and a distinctive selected Codex 0.144.1 template
    const catalog = buildCodexCatalog(
      [{ id: 'ordinary-model', object: 'model' }],
      bundledCatalog.template,
    )

    // When: Codex consumes the generated catalog row
    const payload = JSON.parse(catalog.json)
    const model = payload.models[0]

    // Then: prompt/tool behavior comes from Codex while gateway-only claims remain conservative
    expect(model).toMatchObject({
      slug: 'ordinary-model',
      display_name: 'ordinary-model',
      description: 'LiteLLM gateway model',
      base_instructions: bundledCatalog.template.base_instructions,
      model_messages: bundledCatalog.template.model_messages,
      include_skills_usage_instructions:
        bundledCatalog.template.include_skills_usage_instructions,
      shell_type: bundledCatalog.template.shell_type,
      apply_patch_tool_type: bundledCatalog.template.apply_patch_tool_type,
      web_search_tool_type: bundledCatalog.template.web_search_tool_type,
      comp_hash: bundledCatalog.template.comp_hash,
      tool_mode: bundledCatalog.template.tool_mode,
      multi_agent_version: bundledCatalog.template.multi_agent_version,
      supported_reasoning_levels: [],
      visibility: 'list',
      supported_in_api: true,
      additional_speed_tiers: [],
      service_tiers: [],
      availability_nux: null,
      upgrade: null,
      input_modalities: ['text'],
      supports_image_detail_original: false,
      supports_parallel_tool_calls: false,
      supports_search_tool: false,
      context_window: 200_000,
      max_context_window: 200_000,
      use_responses_lite: false,
      priority: 1,
    })
    expect(model.supports_reasoning_summary_parameter).toBeUndefined()
    expect(model.prefer_websockets).toBeUndefined()
  })

  test('does not elevate Qwen when it is the only discovered model', () => {
    const catalog = buildCodexCatalog(
      [{ id: QWEN_GATEWAY_MODEL, object: 'model' }],
      bundledCatalog.template,
    )
    const payload = JSON.parse(catalog.json)

    expect(catalog.defaultModel).toBe(QWEN_GATEWAY_MODEL)
    expect(payload.models[0].priority).toBe(1)
  })

  test('filters explicit and metadata-free non-chat routes with the shared classifier', () => {
    const catalog = buildCodexCatalog([
      { id: 'embedding-route', mode: 'embedding' },
      { id: 'image-route', type: 'image_generation' },
      { id: 'audio-route', model_type: 'audio_speech' },
      { id: 'multimodal-chat', mode: 'chat', type: 'image' },
      { id: 'cliproxy/gpt-image-chat-compatible', object: 'model', mode: 'chat' },
      { id: 'qwen/qwen3-embedding-8b', object: 'model' },
      { id: 'cliproxy/gpt-image-1.5', object: 'model' },
      { id: 'cliproxy/gpt-image-2', object: 'model' },
      { id: 'cliproxy/wan2.2-i2v-flash', object: 'model' },
      { id: 'cliproxy/wan2.2-t2v-plus', object: 'model' },
      { id: 'cliproxy/wan2.2-r2v-flash', object: 'model' },
      { id: 'openai/gpt-4o-mini-tts', object: 'model' },
      { id: 'openai/gpt-4o-transcribe', object: 'model' },
    ], bundledCatalog.template)
    const payload = JSON.parse(catalog.json)

    expect(payload.models.map((model: { slug: string }) => model.slug)).toEqual([
      'cliproxy/gpt-image-chat-compatible',
      'multimodal-chat',
    ])
  })
})
