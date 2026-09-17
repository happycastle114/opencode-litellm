import { expect, test } from 'bun:test'
import { buildCodexCatalog } from '../src/cli/codex-catalog'
import { BUNDLED_CATALOG } from './client-installer-test-support'
import { buildOpenCodeProvider } from '../src/cli/opencode-provider'
import { applyOpenCodeEdits, planOpenCodeEdits } from '../src/cli/opencode-config'

const models = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'].map((id) => ({ id }))
const intent = { baseUrl: 'https://gateway.example.test', authEnv: 'TEST_GATEWAY_KEY', models, search: [], mcp: [], disableMcp: [] }

test('defaults a narrow student install to auto and removes retired LiteLLM picker entries', () => {
  // Given: a student receives the four authorized routes, with stale local models
  const source = JSON.stringify({ model: 'litellm/gpt-5.6-sol', provider: { litellm: { models: { 'zai/glm': { name: 'old' } } } } })
  // When: both clients receive their installation configuration
  const openCode = JSON.parse(applyOpenCodeEdits(source, planOpenCodeEdits(source, intent)))
  const codex = buildCodexCatalog(models, BUNDLED_CATALOG)
  // Then: both default to the authorized router with its safe shared context
  expect(openCode.model).toBe('litellm/student-auto')
  expect(openCode.small_model).toBe('litellm/gpt-5.6-luna')
  expect(Object.keys(openCode.provider.litellm.models).sort()).toEqual(models.map((model) => model.id).sort())
  expect(openCode.provider.litellm.models['student-auto'].limit).toEqual({ context: 500_000, output: 128_000 })
  expect(codex.defaultModel).toBe('student-auto')
  expect(JSON.parse(codex.json).models[0].context_window).toBe(500_000)
})

test('preserves broad owner defaults and explicit direct model selection', () => {
  // Given: an owner sees additional models beyond the student contract
  const ownerModels = [...models, { id: 'coding-fast' }]
  // When: owner settings are regenerated or a student explicitly selects Terra
  const owner = buildCodexCatalog(ownerModels, BUNDLED_CATALOG)
  const explicit = buildCodexCatalog(models, BUNDLED_CATALOG, 'gpt-5.6-terra')
  const provider = buildOpenCodeProvider({ provider: { litellm: { models: { 'owner-custom': { name: 'Custom' } } } } }, { ...intent, models: ownerModels })
  // Then: the student-only automatic default does not change owner/custom choices
  const ownerConfig = JSON.parse(applyOpenCodeEdits('{"small_model":"owner/custom"}', planOpenCodeEdits('{"small_model":"owner/custom"}', { ...intent, models: ownerModels })))
  expect(ownerConfig.small_model).toBe('owner/custom')
  expect(owner.defaultModel).toBe('coding-fast')
  expect(explicit.defaultModel).toBe('gpt-5.6-terra')
  expect(provider.models).toHaveProperty('owner-custom')
})

test.each([
  { model: 'openai/gpt-6-astra', small: 'openai/gpt-5.6-luna', expectedSmall: 'openai/gpt-5.6-luna' },
  { model: 'openai/gpt-6-astra', small: undefined, expectedSmall: undefined },
  { model: 'litellm/gpt-5.6-terra', small: 'anthropic/claude-haiku', expectedSmall: 'anthropic/claude-haiku' },
  { model: 'litellm/gpt-5.6-terra', small: undefined, expectedSmall: 'litellm/gpt-5.6-luna' },
])('installer preserves explicit defaults alongside a narrow student gateway: %j', ({ model, small, expectedSmall }) => {
  // Given: the authorized gateway coexists with an explicit primary or small-model selection
  const source = JSON.stringify({ model, ...(small === undefined ? {} : { small_model: small }) })

  // When: the installer refreshes that gateway
  const config = JSON.parse(applyOpenCodeEdits(source, planOpenCodeEdits(source, intent)))

  // Then: primary choices survive and only an applicable missing small default uses Luna
  expect(config.model).toBe(model)
  expect(config.small_model).toBe(expectedSmall)
})

test.each([
  { model: 'litellm/owner-model-0', small_model: 'litellm/owner-model-1' },
  { model: 'openai/gpt-6-astra', small_model: 'openai/gpt-5.6-luna' },
])('installer preserves defaults in a broad owner catalog containing student aliases: %j', (defaults) => {
  // Given: the owner sees 96 routes, including all student aliases
  const ownerModels = [...models, ...Array.from({ length: 92 }, (_, index) => ({ id: `owner-model-${index}` }))]
  const source = JSON.stringify(defaults)

  // When: discovery updates the owner's provider catalog
  const config = JSON.parse(applyOpenCodeEdits(source, planOpenCodeEdits(source, { ...intent, models: ownerModels })))

  // Then: the presence of student aliases does not replace either owner default
  expect({ model: config.model, small_model: config.small_model }).toEqual(defaults)
})

test.each([undefined, 'litellm/revoked-model'])('installer replaces missing or revoked default %s while preserving another provider small model', (selected) => {
  // Given: a previous LiteLLM choice is no longer authorized but the small model is independent
  const source = JSON.stringify({ model: selected, small_model: 'anthropic/claude-haiku' })

  // When: the student gateway is refreshed
  const config = JSON.parse(applyOpenCodeEdits(source, planOpenCodeEdits(source, intent)))

  // Then: only the revoked selection is replaced
  expect(config.model).toBe('litellm/student-auto')
  expect(config.small_model).toBe('anthropic/claude-haiku')
})
