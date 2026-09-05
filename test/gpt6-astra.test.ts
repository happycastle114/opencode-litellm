import { expect, test } from 'bun:test'
import { buildCodexCatalog } from '../src/cli/codex-catalog'
import { toOpenCodeProviderModel } from '../src/cli/opencode-provider-model'

const ASTRA = 'gpt-6-astra'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

test('exposes Astra capabilities in both client selectors when discovery only returns its id', () => {
  // Given: a metadata-free public gateway model
  const model = { id: ASTRA, object: 'model' }
  // When: both client selectors are built
  const openCode = toOpenCodeProviderModel(model)
  const codex = JSON.parse(buildCodexCatalog([model], {}).json).models[0]
  // Then: documented limits, image input and reasoning levels are selectable
  expect(openCode).toMatchObject({ limit: { context: 1_050_000, output: 128_000 }, attachment: true, tool_call: true, reasoning: true, modalities: { input: ['text', 'image'], output: ['text'] } })
  expect(Object.keys(openCode?.variants ?? {})).toEqual(EFFORTS)
  expect(codex).toMatchObject({ context_window: 1_050_000, input_modalities: ['text', 'image'], default_reasoning_level: 'medium' })
  expect(codex.supported_reasoning_levels.map((level: { effort: string }) => level.effort)).toEqual(EFFORTS)
})

test('preserves explicit selection and the established gateway default when Astra appears', () => {
  // Given: existing default and Astra are both available
  const models = [{ id: 'coding-fast' }, { id: ASTRA }]
  // When: selection is automatic or explicitly supplied
  const automatic = buildCodexCatalog(models, {})
  const explicit = buildCodexCatalog(models, {}, ASTRA)
  // Then: the existing policy and explicit user selection are preserved
  expect(automatic.defaultModel).toBe('coding-fast')
  expect(explicit.defaultModel).toBe(ASTRA)
})

test('selects Astra ahead of legacy routes when retired router defaults are absent', () => {
  // Given: only current named routes remain
  const models = [{ id: 'gpt-5.6-sol' }, { id: ASTRA }]
  // When: a new catalogue needs a default
  const catalog = buildCodexCatalog(models, {})
  // Then: Astra is default while an explicit Sol choice still wins
  expect(catalog.defaultModel).toBe(ASTRA)
  expect(buildCodexCatalog(models, {}, 'gpt-5.6-sol').defaultModel).toBe('gpt-5.6-sol')
})
