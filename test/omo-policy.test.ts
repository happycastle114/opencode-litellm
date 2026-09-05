import { expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import { parseOmoPolicy, type OmoPolicy } from '../src/omo/policy'
import { renderOmoPolicy } from '../src/omo/profile'

const allowed = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra']
const root = (omo: unknown) => ({ data: [{ model_name: 'student-auto', model_info: { metadata: { omo } } }] })
const policy = { version: 1, agents: { explore: { model: 'gpt-5.6-luna', fallback_models: [] } }, categories: {} }

test('server OMO assignment replaces managed model and fallbacks, preserving custom settings and providers', () => {
  const parsed = parseOmoPolicy(root(policy), allowed)
  const source = `{// keep this comment\n"agents":{"explore":{"model":"litellm/old","fallback_models":["alibaba/old"],"temperature":0.3,"prompt_append":"keep"},"custom":{"model":"openai/private"}},"categories":{},"disabled_hooks":["keep"]}`
  if (parsed === undefined) throw new Error('Expected policy fixture')
  const output = renderOmoPolicy(source, parsed)
  expect(output).toContain('// keep this comment')
  expect(parseJsonc(output)).toEqual({ agents: {
    explore: { model: 'litellm/gpt-5.6-luna', fallback_models: [], temperature: 0.3, prompt_append: 'keep' },
    custom: { model: 'openai/private' },
  }, categories: {}, disabled_hooks: ['keep'] })
  expect(renderOmoPolicy(output, parsed)).toBe(output)
})

test('policy preserves an explicitly external provider slot', () => {
  expect(parseJsonc(renderOmoPolicy('{"agents":{"explore":{"model":"openai/private"}}}', requiredPolicy())).agents.explore.model).toBe('openai/private')
})

test('rejects unauthorized assignments, unsupported versions and conflicting roots', () => {
  expect(() => parseOmoPolicy(root({ ...policy, version: 2 }), allowed)).toThrow()
  expect(() => parseOmoPolicy(root({ ...policy, agents: { explore: { model: 'private', fallback_models: [] } } }), allowed)).toThrow()
  expect(() => parseOmoPolicy(root({ ...policy, agents: { explore: { model: 'gpt-5.6-luna', fallback_models: ['private'] } } }), allowed)).toThrow()
  expect(() => parseOmoPolicy({ data: [...root(policy).data, ...root({ ...policy, agents: {} }).data] }, allowed)).toThrow()
  expect(parseOmoPolicy(root(policy), ['gpt-5.6-luna'])).toBeUndefined()
})

function requiredPolicy(): OmoPolicy {
  const parsed = parseOmoPolicy(root(policy), allowed)
  if (parsed === undefined) throw new Error('Expected policy fixture')
  return parsed
}

test('updates only explicit reasoning fields and never imports endpoint or credential metadata', () => {
  const parsed = parseOmoPolicy(root({ ...policy, agents: { explore: {
    model: 'gpt-5.6-terra', fallback_models: ['gpt-5.6-luna'], variant: 'high', reasoningEffort: 'high',
  } } }), allowed)
  if (parsed === undefined) throw new Error('Expected policy fixture')
  const output = parseJsonc(renderOmoPolicy('{"agents":{"explore":{"model":"litellm/old","variant":"max","reasoningEffort":"max","permission":{"bash":"deny"}}}}', parsed))
  expect(output.agents.explore).toEqual({ model:'litellm/gpt-5.6-terra', fallback_models:['litellm/gpt-5.6-luna'], variant:'high',reasoningEffort:'high',permission:{bash:'deny'} })
  expect(() => parseOmoPolicy(root({ ...policy, agents: { explore: { model:'gpt-5.6-luna',fallback_models:[],apiKey:'must-not-import' } } }), allowed)).toThrow()
  const preserved = parseJsonc(renderOmoPolicy(JSON.stringify(output), requiredPolicy()))
  expect(preserved.agents.explore.variant).toBe('high')
  expect(preserved.agents.explore.reasoningEffort).toBe('high')
})
