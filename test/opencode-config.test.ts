import { describe, expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import { planOpenCodeEdits, applyOpenCodeEdits } from '../src/cli/opencode-config'
import { ConfigurationError } from '../src/cli/errors'
import packageJson from '../package.json' with { type: 'json' }

const PACKAGE_VERSION = packageJson.version
const PLUGIN_SPEC = `opencode-plugin-litellm@${PACKAGE_VERSION}`

const baseIntent = {
  baseUrl: 'https://litellm.example.com',
  authEnv: 'LITELLM_API_KEY',
  search: [],
  mcp: [],
  disableMcp: [],
} as const

function render(source: string, intent = baseIntent): string {
  const edits = planOpenCodeEdits(source, intent)
  return applyOpenCodeEdits(source, edits)
}

describe('opencode JSONC editing', () => {
  test('creates provider and plugin in an empty config', () => {
    // Given: an empty JSON object
    // When: the opencode edits are applied
    const output = render('{}')
    const parsed = parseJsonc(output)

    // Then: the provider is shaped with an env reference only
    expect(parsed.provider.litellm).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'LiteLLM',
      options: {
        baseURL: 'https://litellm.example.com/v1',
        apiKey: '{env:LITELLM_API_KEY}',
      },
    })
    expect(parsed.plugin).toEqual([PLUGIN_SPEC])
  })

  test('preserves comments and unrelated keys', () => {
    // Given: a config with comments and unrelated content
    const source = `{
  // top-level comment
  "$schema": "https://opencode.ai/config.json",
  "theme": "dark", // trailing comment
  "keybinds": { "leader": "ctrl+x" }
}`
    // When: edits are applied
    const output = render(source)

    // Then: comments and unrelated keys survive verbatim
    expect(output).toContain('// top-level comment')
    expect(output).toContain('// trailing comment')
    expect(output).toContain('"theme": "dark"')
    expect(output).toContain('"leader": "ctrl+x"')
    const parsed = parseJsonc(output)
    expect(parsed.theme).toBe('dark')
    expect(parsed.keybinds.leader).toBe('ctrl+x')
  })

  test('preserves unrelated plugins while adding the litellm spec', () => {
    // Given: an existing unrelated plugin entry
    const source = `{
  "plugin": ["some-other-plugin@1.0.0"]
}`
    // When: edits are applied
    const output = render(source)
    const parsed = parseJsonc(output)

    // Then: both the unrelated plugin and the new spec are present
    expect(parsed.plugin).toContain('some-other-plugin@1.0.0')
    expect(parsed.plugin).toContain(PLUGIN_SPEC)
  })

  test('replaces an older opencode-litellm string entry without disturbing others', () => {
    // Given: a stale opencode-litellm plugin pin plus an unrelated plugin
    const source = `{
  "plugin": ["opencode-plugin-litellm@0.0.1", "keep-me@2.0.0"]
}`
    // When: edits are applied
    const output = render(source)
    const parsed = parseJsonc(output)

    // Then: only one litellm entry remains and the unrelated one is intact
    const litellm = (parsed.plugin as unknown[]).filter(
      (entry) => typeof entry === 'string' && entry.startsWith('opencode-plugin-litellm@'),
    )
    expect(litellm).toEqual([PLUGIN_SPEC])
    expect(parsed.plugin).toContain('keep-me@2.0.0')
    expect(parsed.plugin).not.toContain('opencode-plugin-litellm@0.0.1')
  })

  test('replaces an older opencode-litellm tuple entry', () => {
    // Given: a stale tuple form entry
    const source = `{
  "plugin": [["opencode-plugin-litellm@0.0.1", { "searchTools": [] }], "keep@1.0.0"]
}`
    // When: edits are applied
    const output = render(source)
    const parsed = parseJsonc(output)

    // Then: the tuple is replaced with the exact version and unrelated kept
    const litellm = (parsed.plugin as unknown[]).filter((entry) => {
      const spec = Array.isArray(entry) ? entry[0] : entry
      return typeof spec === 'string' && spec.startsWith('opencode-plugin-litellm@')
    })
    expect(litellm).toHaveLength(1)
    const spec = Array.isArray(litellm[0]) ? litellm[0][0] : litellm[0]
    expect(spec).toBe(PLUGIN_SPEC)
    expect(parsed.plugin).toContain('keep@1.0.0')
  })

  test('uses the exact package version in the plugin spec', () => {
    // Given: an empty config
    // When: rendered
    const parsed = parseJsonc(render('{}'))
    const spec = (parsed.plugin as unknown[])[0]

    // Then: the spec pins the exact package version (never floating)
    expect(spec).toBe(PLUGIN_SPEC)
    expect(String(spec)).not.toContain('latest')
    expect(String(spec)).not.toContain('*')
    expect(String(spec)).not.toContain('^')
  })

  test('writes only an env reference and never a secret value', () => {
    // Given: an install with an env-based key
    // When: rendered
    const output = render('{}')

    // Then: only the placeholder appears, no resolved secret
    expect(output).toContain('{env:LITELLM_API_KEY}')
    expect(output).not.toContain('sk-')
  })

  test('emits a search tuple when search options are enabled', () => {
    // Given: an install requesting the default search tool
    const intent = { ...baseIntent, search: ['agy-search'] } as const
    // When: rendered
    const parsed = parseJsonc(render('{}', intent))
    const entry = (parsed.plugin as unknown[])[0]

    // Then: the plugin entry is a tuple whose options carry searchTools
    expect(Array.isArray(entry)).toBe(true)
    if (!Array.isArray(entry)) return
    expect(entry[0]).toBe(PLUGIN_SPEC)
    expect(entry[1].searchTools).toEqual([
      {
        toolName: 'websearch',
        searchToolName: 'agy-search',
        overrideBuiltin: true,
        defaultMaxResults: 8,
      },
    ])
  })

  test('emits an mcpDiscovery block when mcp options are enabled', () => {
    // Given: an install selecting mcp servers with a disabled override
    const intent = {
      ...baseIntent,
      mcp: ['zread', 'zai-web-reader'],
      disableMcp: ['minimax-search'],
    } as const
    // When: rendered
    const parsed = parseJsonc(render('{}', intent))
    const entry = (parsed.plugin as unknown[])[0]

    // Then: the mcpDiscovery block lists includes and server overrides
    expect(Array.isArray(entry)).toBe(true)
    if (!Array.isArray(entry)) return
    const options = entry[1]
    expect(options.mcpDiscovery.enabled).toBe(true)
    expect(options.mcpDiscovery.include).toEqual(['zread', 'zai-web-reader'])
    expect(options.mcpDiscovery.servers).toEqual([
      { serverName: 'minimax-search', enabled: false },
    ])
  })

  test('does not persist model lists or discovered mcp state', () => {
    // Given: an install with search and mcp
    const intent = { ...baseIntent, search: ['agy-search'], mcp: ['zread'] } as const
    // When: rendered
    const output = render('{}', intent)
    const parsed = parseJsonc(output)

    // Then: no discovered models or runtime mcp urls are written
    expect(parsed.provider.litellm.models).toBeUndefined()
    expect(parsed.mcp).toBeUndefined()
    expect(output).not.toContain('/mcp')
  })

  test('is idempotent across repeated applies', () => {
    // Given: an intent applied once
    const intent = { ...baseIntent, search: ['agy-search'], mcp: ['zread'] } as const
    const once = render('{}', intent)
    // When: applied a second time to its own output
    const twice = render(once, intent)

    // Then: the output is byte-identical
    expect(twice).toBe(once)
  })

  test('rejects malformed JSONC with a typed configuration error carrying the path', () => {
    // Given: syntactically broken JSONC
    const source = '{ "plugin": [ '
    // When: planning edits
    // Then: a ConfigurationError names the source path
    expect(() => planOpenCodeEdits(source, baseIntent, '/tmp/opencode.jsonc')).toThrow(
      ConfigurationError,
    )
    try {
      planOpenCodeEdits(source, baseIntent, '/tmp/opencode.jsonc')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      if (error instanceof ConfigurationError) {
        expect(error.path).toBe('/tmp/opencode.jsonc')
      }
    }
  })

  test('normalizes a trailing slash origin to a single /v1 suffix', () => {
    // Given: a base url that already carries a trailing slash
    const intent = { ...baseIntent, baseUrl: 'https://litellm.example.com/' } as const
    // When: rendered
    const parsed = parseJsonc(render('{}', intent))

    // Then: exactly one /v1 suffix is produced
    expect(parsed.provider.litellm.options.baseURL).toBe('https://litellm.example.com/v1')
  })
})
