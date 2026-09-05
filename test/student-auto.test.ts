import { expect, test } from 'bun:test'
import { buildCodexCatalog } from '../src/cli/codex-catalog'
import { buildOpenCodeProvider } from '../src/cli/opencode-provider'
import { applyOpenCodeEdits, planOpenCodeEdits } from '../src/cli/opencode-config'

const models = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'].map((id) => ({ id }))
const intent = { baseUrl: 'https://gateway.example.test', authEnv: 'TEST_GATEWAY_KEY', models, search: [], mcp: [], disableMcp: [] }

test('defaults a narrow student install to auto and removes retired LiteLLM picker entries', () => {
  // Given: a student receives the four authorized routes, with stale local models
  const source = JSON.stringify({ model: 'litellm/gpt-5.6-sol', provider: { litellm: { models: { 'zai/glm': { name: 'old' } } } } })
  // When: both clients receive their installation configuration
  const openCode = JSON.parse(applyOpenCodeEdits(source, planOpenCodeEdits(source, intent)))
  const codex = buildCodexCatalog(models, {})
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
  const owner = buildCodexCatalog(ownerModels, {})
  const explicit = buildCodexCatalog(models, {}, 'gpt-5.6-terra')
  const provider = buildOpenCodeProvider({ provider: { litellm: { models: { 'owner-custom': { name: 'Custom' } } } } }, { ...intent, models: ownerModels })
  // Then: the student-only automatic default does not change owner/custom choices
  const ownerConfig = JSON.parse(applyOpenCodeEdits('{"small_model":"owner/custom"}', planOpenCodeEdits('{"small_model":"owner/custom"}', { ...intent, models: ownerModels })))
  expect(ownerConfig.small_model).toBe('owner/custom')
  expect(owner.defaultModel).toBe('coding-fast')
  expect(explicit.defaultModel).toBe('gpt-5.6-terra')
  expect(provider.models).toHaveProperty('owner-custom')
})
