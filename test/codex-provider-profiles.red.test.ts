import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse as parseToml } from 'smol-toml'
import * as codexConfig from '../src/cli/codex-config'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'

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

const EXPECTED_PROVIDER_ID = {
  GatewaySso: 'litellm-gateway-sso',
  CodexOAuth: 'litellm-codex-oauth',
} as const

const HEADER_NAME = {
  LiteLLMApiKey: 'x-litellm-api-key',
} as const

const intent = {
  baseUrl: 'https://litellm.example.com',
  authEnv: 'LITELLM_PROXY_API_KEY',
  authCommand: '/home/test/.codex/libexec/litellm-auth-token',
  catalogPath: '/home/test/.codex/litellm-models.json',
  defaultModel: 'gateway/dynamic-model',
  mcp: ['research_docs', 'zread'],
  disableMcp: ['research_docs'],
} as const

describe('Codex provider profiles', () => {
  test('exports stable provider identifiers for config consumers', () => {
    // Given: the public Codex configuration module
    // When: consumers inspect its provider identifier contract
    // Then: both provider modes have stable, non-overlapping identifiers
    expect(codexConfig).toHaveProperty('CodexProviderId', EXPECTED_PROVIDER_ID)
  })

  test('uses command-backed auth exclusively for the gateway SSO provider', () => {
    // Given: a stable absolute auth-token helper path
    const output = codexConfig.renderCodexConfig('', intent)

    // When: the managed base configuration is parsed
    const parsed = parseToml(output)
    const provider = parsed.model_providers?.[EXPECTED_PROVIDER_ID.GatewaySso]

    // Then: the gateway provider selects only command-backed authentication
    expect(parsed.model_provider).toBe(EXPECTED_PROVIDER_ID.GatewaySso)
    expect(parsed.model_catalog_json).toBe(intent.catalogPath)
    expect(provider).toBeDefined()
    expect(provider.auth?.command).toBe(intent.authCommand)
    expect(provider.env_key).toBeUndefined()
    expect(provider.experimental_bearer_token).toBeUndefined()
    expect(provider.requires_openai_auth).toBeUndefined()
  })

  test('keeps Codex OAuth authentication separate from gateway credentials', () => {
    // Given: the managed base configuration with a proxy-key environment reference
    const output = codexConfig.renderCodexConfig('', intent)

    // When: the OAuth provider is parsed independently
    const provider = parseToml(output).model_providers?.[EXPECTED_PROVIDER_ID.CodexOAuth]

    // Then: ChatGPT OAuth owns Authorization and LiteLLM uses a separate header
    expect(provider).toBeDefined()
    expect(provider.requires_openai_auth).toBe(true)
    expect(provider.env_http_headers).toEqual({
      [HEADER_NAME.LiteLLMApiKey]: intent.authEnv,
    })
    expect(provider.auth).toBeUndefined()
    expect(provider.env_key).toBeUndefined()
    expect(provider.experimental_bearer_token).toBeUndefined()
  })

  test('renders every discovered MCP selection without a built-in server list', () => {
    // Given: a discovery result containing a server unique to this fixture
    const output = codexConfig.renderCodexConfig('', intent)

    // When: Codex parses the generated MCP tables
    const servers = parseToml(output).mcp_servers

    // Then: the discovered server is present with its selected state
    expect(servers.litellm_research_docs.url).toBe(
      `${intent.baseUrl}/research_docs/mcp`,
    )
    expect(servers.litellm_research_docs.enabled).toBe(false)
    expect(servers.litellm_zread.enabled).toBe(true)
  })
})

describe('Codex model catalog', () => {
  test('emits parseable picker entries without inventing unknown capabilities', () => {
    // Given: a model discovered without capability metadata
    const catalog = codexConfig.buildCodexCatalog([
      { id: 'vendor/unknown-model', object: 'model' },
    ], bundledCatalog.template)

    // When: Codex reads the generated JSON catalog
    const payload: unknown = JSON.parse(catalog.json)
    expect(isRecord(payload)).toBe(true)
    if (!isRecord(payload)) return
    const models = payload.models
    expect(Array.isArray(models)).toBe(true)
    if (!Array.isArray(models)) return
    const model: unknown = models[0]
    expect(isRecord(model)).toBe(true)
    if (!isRecord(model)) return

    // Then: it is picker-visible while unsupported capabilities remain conservative
    expect(model.slug).toBe('vendor/unknown-model')
    expect(model.visibility).toBe('list')
    expect(model.supported_in_api).toBe(true)
    expect(model.supported_reasoning_levels).toEqual([])
    expect(model.supports_reasoning_summaries).toBe(false)
    expect(model.supports_reasoning_summary_parameter).toBeUndefined()
    expect(model.supports_parallel_tool_calls).toBe(false)
    expect(model.input_modalities).toEqual(['text'])
    expect(model.base_instructions).toBe(bundledCatalog.template.base_instructions)
    expect(model.model_messages).toEqual(bundledCatalog.template.model_messages)
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
