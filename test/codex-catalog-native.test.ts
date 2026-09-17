import { describe, expect, test } from 'bun:test'
import { buildCodexCatalog } from '../src/cli/codex-catalog'
import { readBundledCodexCatalog } from '../src/cli/codex-bundled-catalog'
import { BUNDLED_CATALOG_FIXTURE } from './cli-program-test-support'

const bundled = readBundledCodexCatalog({ spawn: () => ({ status: 0, stdout: BUNDLED_CATALOG_FIXTURE }) })
const nativeModel = {
  ...bundled.template,
  slug: 'native-specialized',
  priority: 20,
  context_window: 320_000,
  max_context_window: 800_000,
  auto_compact_token_limit: 275_000,
  input_modalities: ['text', 'image'],
  supported_reasoning_levels: [{ effort: 'high', description: 'high' }, { effort: 'ultra', description: 'ultra' }],
  supports_parallel_tool_calls: true,
  comp_hash: 'native-model-specific-hash',
}
const current = readBundledCodexCatalog({ spawn: () => ({ status: 0, stdout: JSON.stringify({
  models: [bundled.template, nativeModel],
}) }) })

describe('Codex native model capabilities', () => {
  test('inherits the exact native model rather than the default model template', () => {
    // Given: a gateway row matching a non-default native model
    const catalog = buildCodexCatalog([{ id: nativeModel.slug }], current)

    // When: the managed catalog is read
    const row = JSON.parse(catalog.json).models[0]

    // Then: model-specific machine capabilities survive gateway routing
    expect(row).toMatchObject({
      context_window: nativeModel.context_window,
      max_context_window: nativeModel.max_context_window,
      auto_compact_token_limit: nativeModel.auto_compact_token_limit,
      input_modalities: nativeModel.input_modalities,
      supported_reasoning_levels: nativeModel.supported_reasoning_levels,
      supports_parallel_tool_calls: nativeModel.supports_parallel_tool_calls,
      comp_hash: nativeModel.comp_hash,
    })
  })

  test('uses gateway context and vision metadata for an unknown route', () => {
    // Given: a gateway alias with authoritative capability metadata
    const catalog = buildCodexCatalog([{ id: 'gateway-custom', max_input_tokens: 90_000,
      supports_vision: true }], current)

    // When: the managed catalog is read
    const row = JSON.parse(catalog.json).models[0]

    // Then: the alias is not assigned arbitrary generic limits or text-only input
    expect(row.context_window).toBe(90_000)
    expect(row.max_context_window).toBe(90_000)
    expect(row.auto_compact_token_limit).toBe(81_000)
    expect(row.input_modalities).toEqual(['text', 'image'])
  })

  test('gateway constraints override native capabilities for a restricted deployment', () => {
    // Given: the gateway explicitly limits the named native model
    const catalog = buildCodexCatalog([{ id: nativeModel.slug, max_input_tokens: 64_000,
      input_modalities: ['text'], supports_vision: false }], current)

    // When: the managed catalog is read
    const row = JSON.parse(catalog.json).models[0]

    // Then: current gateway constraints bound Codex's model behavior
    expect(row.context_window).toBe(64_000)
    expect(row.max_context_window).toBe(64_000)
    expect(row.input_modalities).toEqual(['text'])
  })
})
