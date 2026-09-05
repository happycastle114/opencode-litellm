import { expect, test } from 'bun:test'
import { buildCodexCatalog } from '../src/cli/codex-catalog'
import { toOpenCodeProviderModel } from '../src/cli/opencode-provider-model'

const TERRA = 'gpt-5.6-terra'
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

test.each([TERRA, `openai/${TERRA}`])('exposes the Terra profile for discovered route %s', (id) => {
  // Given: discovery exposes only a public or provider-qualified route
  const model = { id }
  // When: the two client selectors build their entries
  const openCode = toOpenCodeProviderModel(model)
  const codex = JSON.parse(buildCodexCatalog([model], {}).json).models[0]
  // Then: Terra has its own complete reasoning and multimodal capabilities
  expect(openCode).toMatchObject({ name: 'GPT-5.6 Terra', limit: { context: 1_050_000, output: 128_000 }, modalities: { input: ['text', 'image'], output: ['text'] }, tool_call: true, reasoning: true })
  expect(Object.keys(openCode?.variants ?? {})).toEqual(EFFORTS)
  expect(codex).toMatchObject({ display_name: 'GPT-5.6 Terra', context_window: 1_050_000, input_modalities: ['text', 'image'], default_reasoning_level: 'medium' })
  expect(codex.supported_reasoning_levels.map((level: { effort: string }) => level.effort)).toEqual(EFFORTS)
})

test('keeps explicit Terra selected when Astra is available', () => {
  // Given: two current gateway models
  const models = [{ id: TERRA }, { id: 'gpt-6-astra' }]
  // When: the user explicitly selects Terra
  const catalog = buildCodexCatalog(models, {}, TERRA)
  // Then: the selected model remains the default
  expect(catalog.defaultModel).toBe(TERRA)
})
