import { describe, expect, test } from 'bun:test'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  OH_MY_OPENAGENT_MANAGED_AGENTS,
  OH_MY_OPENAGENT_MANAGED_CATEGORIES,
  QWEN_OPENCODE_MODEL,
  renderOhMyOpenAgentProfile,
  renderQwenRoutingProfile,
} from '../src/cli/qwen-routing'

describe('Oh My OpenAgent Qwen routing profile', () => {
  test('disables the OpenAgent websearch MCP without Qwen routing', () => {
    const source = `{
  // keep the existing MCP choices and their order
  "disabled_mcps": [
    "context7",
    // user-managed entry
    "filesystem"
  ],
  "agents": {
    "plan": { "model": "openai/gpt-5.6" }
  }
}
`

    const output = renderOhMyOpenAgentProfile(source, {
      qwenRoutingEnabled: false,
    })
    const parsed = parseJsonc(output)

    expect(parsed.disabled_mcps).toEqual(['context7', 'filesystem', 'websearch'])
    expect(parsed.agents.plan.model).toBe('openai/gpt-5.6')
    expect(parsed.categories).toBeUndefined()
    expect(output).toContain('// keep the existing MCP choices and their order')
    expect(output).toContain('// user-managed entry')
  })

  test('merges websearch into disabled MCPs when Qwen is absent', () => {
    const source = `{
  "disabled_mcps": [
    // this remains user-managed
    "context7"
  ],
  "keep": true
}
`

    const output = renderOhMyOpenAgentProfile(source, {
      qwenRoutingEnabled: false,
    })

    const parsed = parseJsonc(output)
    expect(parsed.disabled_mcps).toEqual(['context7', 'websearch'])
    expect(parsed.keep).toBe(true)
    expect(output).toContain('// this remains user-managed')
  })

  test('does not duplicate an existing websearch MCP across repeated installs', () => {
    const source = `{
  "disabled_mcps": [
    "context7",
    "websearch"
  ]
}
`
    const intent = {
      qwenRoutingEnabled: false,
    } as const

    const once = renderOhMyOpenAgentProfile(source, intent)
    const twice = renderOhMyOpenAgentProfile(once, intent)

    expect(once).toBe(source)
    expect(twice).toBe(once)
  })

  test('removes only stale installer-managed Qwen models when Qwen is absent', () => {
    const source = `{
  // preserve unrelated routes and fields
  "agents": {
    "plan": {
      "model": "${QWEN_OPENCODE_MODEL}",
      "fallback_models": ["openai/gpt-5.6"]
    },
    "librarian": { "model": "openai/gpt-5.6" },
    "sisyphus": { "model": "openai/gpt-5.6" }
  },
  "categories": {
    "writing": { "model": "${QWEN_OPENCODE_MODEL}", "temperature": 0.1 },
    "quick": { "model": "openai/gpt-5.6" }
  }
}
`

    const output = renderOhMyOpenAgentProfile(source, {
      qwenRoutingEnabled: false,
    })
    const parsed = parseJsonc(output)

    expect(parsed.disabled_mcps).toEqual(['websearch'])
    expect(parsed.agents.plan).toEqual({ fallback_models: ['openai/gpt-5.6'] })
    expect(parsed.agents.librarian).toEqual({ model: 'openai/gpt-5.6' })
    expect(parsed.agents.sisyphus).toEqual({ model: 'openai/gpt-5.6' })
    expect(parsed.categories.writing).toEqual({ temperature: 0.1 })
    expect(parsed.categories.quick).toEqual({ model: 'openai/gpt-5.6' })
    expect(output).toContain('// preserve unrelated routes and fields')
  })

  test('writes provider-qualified Qwen only to the bounded managed entries', () => {
    const source = `{
  // unrelated high-difficulty route
  "agents": {
    "sisyphus": { "model": "openai/gpt-5.6" },
    "plan": { "model": "openai/gpt-5.6", "temperature": 0.2 }
  },
  "categories": {
    "quick": { "model": "openai/gpt-5.6" },
    "writing": { "model": "openai/gpt-5.6", "temperature": 0.1 },
    "visual-engineering": { "model": "openai/gpt-5.6" }
  },
  "keep": true
}
`

    const output = renderQwenRoutingProfile(source)
    const parsed = parseJsonc(output)

    expect(parsed.keep).toBe(true)
    expect(parsed.agents.sisyphus).toEqual({ model: 'openai/gpt-5.6' })
    expect(parsed.agents.plan).toEqual({ model: QWEN_OPENCODE_MODEL, temperature: 0.2 })
    for (const name of OH_MY_OPENAGENT_MANAGED_AGENTS) {
      expect(parsed.agents[name].model).toBe(QWEN_OPENCODE_MODEL)
    }
    expect(parsed.categories.writing.model).toBe(QWEN_OPENCODE_MODEL)
    expect(parsed.categories.writing.temperature).toBe(0.1)
    expect(parsed.categories['long-context'].model).toBe(QWEN_OPENCODE_MODEL)
    expect(parsed.categories.quick).toEqual({ model: 'openai/gpt-5.6' })
    expect(parsed.categories['visual-engineering']).toEqual({ model: 'openai/gpt-5.6' })
    expect(output).toContain('// unrelated high-difficulty route')
    expect(OH_MY_OPENAGENT_MANAGED_CATEGORIES).toEqual(['writing', 'long-context'])
  })

  test('is byte-idempotent', () => {
    const once = renderQwenRoutingProfile('{}\n')
    const twice = renderQwenRoutingProfile(once)
    expect(twice).toBe(once)
  })
})
