import { describe, expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  OH_MY_OPENAGENT_PLUGIN_SPEC,
  PLUGIN_SPEC,
  baseIntent,
  render,
} from './opencode-config-test-support'
import { planOpenCodeEdits } from '../src/cli/opencode-config'
import { ConfigurationError } from '../src/cli/errors'

describe('opencode JSONC editing', () => {
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

  test('replaces an unversioned managed plugin entry', () => {
    const parsed = parseJsonc(render('{"plugin": ["opencode-plugin-litellm"]}'))
    expect(parsed.plugin).toEqual([PLUGIN_SPEC, OH_MY_OPENAGENT_PLUGIN_SPEC])
  })

  test.each([
    'file:///tmp/vendor/opencode-litellm-git/src/index.ts',
    'file:///tmp/vendor/opencode-litellm-git/83ea2674a8afb578a670188fb3b522fc242a77cb/src/index.ts',
  ])('replaces the previous managed checkout entry at %s', (managedSpec) => {
    const parsed = parseJsonc(render(JSON.stringify({ plugin: [managedSpec, 'keep@1.0.0'] })))
    expect(parsed.plugin).toEqual([PLUGIN_SPEC, OH_MY_OPENAGENT_PLUGIN_SPEC, 'keep@1.0.0'])
  })

  test('pins the official consumer and retires the legacy plugin without clobbering others', () => {
    const source = `{
  "plugin": [
    ["oh-my-opencode@3.0.0", { "legacy": true }],
    ["oh-my-openagent", { "preserved": { "enabled": true } }],
    "keep@1.0.0"
  ]
}`

    const once = render(source)
    const twice = render(once)
    const parsed = parseJsonc(once)

    expect(parsed.plugin).toEqual([
      PLUGIN_SPEC,
      [OH_MY_OPENAGENT_PLUGIN_SPEC, { preserved: { enabled: true } }],
      'keep@1.0.0',
    ])
    expect(twice).toBe(once)
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

})
