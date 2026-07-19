import { expect, test } from 'bun:test'
import * as pluginModule from '../src/index'

test('package root exposes only callable OpenCode plugin factories at runtime', () => {
  // Given: OpenCode calls every runtime export as a plugin factory.
  // When: the package root is imported.
  const exports = Object.entries(pluginModule)

  // Then: only the two backwards-compatible plugin functions are present.
  expect(exports.map(([name]) => name).sort()).toEqual([
    'LiteLLMPlugin',
    'LiteLLMResponsesPlugin',
  ])
  expect(exports.every(([, value]) => typeof value === 'function')).toBe(true)
})
