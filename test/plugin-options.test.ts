import { describe, expect, test } from 'bun:test'
import { LiteLLMPlugin } from '../src/index'

describe('LiteLLMPlugin search tool options', () => {
  test('registers only native web-search when named options are omitted', async () => {
    // Given: the plugin is loaded without tuple options
    // When: OpenCode initializes the plugin
    const hooks = await LiteLLMPlugin({})

    // Then: native search remains available without named search routes
    expect(Object.keys(hooks.tool ?? {})).toEqual(['web-search'])
  })

  test('registers every configured named search tool', async () => {
    // Given: two distinct LiteLLM search tools
    const options = {
      searchTools: [
        {
          toolName: 'litellm_search',
          searchToolName: 'agy-search',
        },
        {
          toolName: 'litellm_exa_search',
          searchToolName: 'exa-search',
          description: 'Search with Exa',
          defaultMaxResults: 7,
        },
      ],
    }

    // When: OpenCode initializes the plugin
    const hooks = await LiteLLMPlugin({}, options)

    // Then: both configured names are exposed through Hooks.tool
    expect(Object.keys(hooks.tool ?? {})).toEqual([
      'web-search',
      'litellm_search',
      'litellm_exa_search',
    ])
  })

  test.each([
    ['reserved native web-search tool ID', { toolName: 'web-search', searchToolName: 'agy-search' }],
    ['reserved websearch tool ID', { toolName: 'websearch', searchToolName: 'agy-search' }],
    ['obsolete overrideBuiltin field', { toolName: 'litellm_search', searchToolName: 'agy-search', overrideBuiltin: true }],
    ['invalid toolName', { toolName: 'Web Search', searchToolName: 'agy-search' }],
    ['invalid searchToolName', { toolName: 'search', searchToolName: '../agy' }],
    ['defaultMaxResults below one', { toolName: 'search', searchToolName: 'agy-search', defaultMaxResults: 0 }],
    ['defaultMaxResults above twenty', { toolName: 'search', searchToolName: 'agy-search', defaultMaxResults: 21 }],
  ])('rejects %s', async (_label, entry) => {
    // Given: one malformed search tool entry
    const options = { searchTools: [entry] }

    // When/Then: plugin initialization fails before registering a bad tool
    await expect(LiteLLMPlugin({}, options)).rejects.toThrow('searchTools')
  })

  test('rejects duplicate OpenCode tool names', async () => {
    // Given: two entries that would register the same Hooks.tool key
    const options = {
      searchTools: [
        { toolName: 'search', searchToolName: 'agy-search' },
        { toolName: 'search', searchToolName: 'exa-search' },
      ],
    }

    // When/Then: ambiguous registration is rejected
    await expect(LiteLLMPlugin({}, options)).rejects.toThrow('searchTools')
  })
})
