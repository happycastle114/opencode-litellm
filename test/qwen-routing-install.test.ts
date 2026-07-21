import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { installPreparedClients } from '../src/cli/client-installer'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault } from '../src/cli/install-intent'
import type { PreparedInstall } from '../src/cli/install-preparation'
import { OH_MY_OPENAGENT_PLUGIN_SPEC } from '../src/cli/opencode-config'
import {
  OH_MY_OPENAGENT_MANAGED_AGENTS,
  OH_MY_OPENAGENT_MANAGED_CATEGORIES,
  QWEN_GATEWAY_MODEL,
  QWEN_OPENCODE_MODEL,
  resolveOhMyOpenAgentProfilePath,
} from '../src/cli/qwen-routing'

const VALUE = {
  gatewayOrigin: 'https://litellm.example.test',
  authEnv: 'LITELLM_PROXY_API_KEY',
} as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'qwen-routing-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('OpenCode Qwen installer integration', () => {
  test('creates an atomic 0600 no-search profile when exact Qwen is discovered', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    const prepared = preparedInstall(opencodePath, [{ id: QWEN_GATEWAY_MODEL }])

    const result = await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    expect(result.warnings).toEqual([])
    expect(existsSync(profilePath)).toBe(true)
    expect(statSync(profilePath).mode & 0o777).toBe(0o600)
    const profile = parseJsonc(readFileSync(profilePath, 'utf8'))
    const opencode = parseJsonc(readFileSync(opencodePath, 'utf8'))
    expect(OH_MY_OPENAGENT_PLUGIN_SPEC).toBe('oh-my-openagent@4.19.0')
    expect(opencode.plugin).toContain(OH_MY_OPENAGENT_PLUGIN_SPEC)
    expect(opencode.plugin[0][1].searchTools).toBeUndefined()
    expect(profile.agents['sisyphus-junior'].model).toBe(QWEN_OPENCODE_MODEL)
    expect(profile.categories.writing.model).toBe(QWEN_OPENCODE_MODEL)
    expect(profile.categories['long-context'].model).toBe(QWEN_OPENCODE_MODEL)
    expect(profile.disabled_mcps).toEqual(['websearch'])
    expect(readFileSync(profilePath, 'utf8')).not.toContain('sk-')
    const first = readFileSync(profilePath, 'utf8')
    await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })
    expect(readFileSync(profilePath, 'utf8')).toBe(first)
  })

  test('creates the no-search policy profile and warns only that Qwen routing was skipped', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    const prepared = preparedInstall(opencodePath, [{ id: 'coding-fast' }])

    const result = await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    expect(existsSync(profilePath)).toBe(true)
    expect(statSync(profilePath).mode & 0o777).toBe(0o600)
    expect(parseJsonc(readFileSync(profilePath, 'utf8')).disabled_mcps).toEqual(['websearch'])
    const opencode = parseJsonc(readFileSync(opencodePath, 'utf8'))
    expect(opencode.plugin[0][1].searchTools).toBeUndefined()
    expect(result.warnings).toEqual([
      `Qwen model routing skipped: gateway model '${QWEN_GATEWAY_MODEL}' was not discovered; Oh My OpenAgent built-in websearch is disabled at ${profilePath}.`,
    ])
  })

  test('preserves an existing profile while enforcing no-search when Qwen is absent', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    mkdirSync(join(homeDirectory, '.config', 'opencode'), { recursive: true })
    const source = '{\n  // preserve this user setting\n  "keep": true\n}\n'
    writeFileSync(profilePath, source)

    await installPreparedClients(preparedInstall(opencodePath, [{ id: 'coding-fast' }]), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    const output = readFileSync(profilePath, 'utf8')
    const profile = parseJsonc(output)
    expect(profile.keep).toBe(true)
    expect(profile.disabled_mcps).toEqual(['websearch'])
    expect(output).toContain('// preserve this user setting')
  })

  test('disables built-in websearch when LiteLLM search is selected and Qwen is absent', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    const prepared = preparedInstall(
      opencodePath,
      [{ id: 'coding-fast' }],
      ['agy-search'],
    )

    await installPreparedClients(prepared, {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    const profile = parseJsonc(readFileSync(profilePath, 'utf8'))
    const opencode = parseJsonc(readFileSync(opencodePath, 'utf8'))
    expect(profile.disabled_mcps).toEqual(['websearch'])
    expect(opencode.plugin[0][1].searchTools).toMatchObject([
      { searchToolName: 'agy-search' },
    ])
  })

  test('retires stale managed Qwen routes when discovery loses Qwen', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    mkdirSync(join(homeDirectory, '.config', 'opencode'), { recursive: true })
    writeFileSync(profilePath, `{
  // preserve user-owned route metadata
  "agents": {
    "plan": { "fallback_models": ["openai/gpt-5.6"] },
    "sisyphus": { "model": "openai/gpt-5.6" }
  }
}
`)

    await installPreparedClients(
      preparedInstall(opencodePath, [{ id: QWEN_GATEWAY_MODEL }]),
      { env: { HOME: homeDirectory }, now: () => new Date(0) },
    )
    await installPreparedClients(
      preparedInstall(opencodePath, [{ id: 'coding-fast' }]),
      { env: { HOME: homeDirectory }, now: () => new Date(0) },
    )

    const once = readFileSync(profilePath, 'utf8')
    const profile = parseJsonc(once)
    for (const name of OH_MY_OPENAGENT_MANAGED_AGENTS) {
      expect(profile.agents[name]?.model).toBeUndefined()
    }
    for (const name of OH_MY_OPENAGENT_MANAGED_CATEGORIES) {
      expect(profile.categories[name]?.model).toBeUndefined()
    }
    expect(profile.agents.plan.fallback_models).toEqual(['openai/gpt-5.6'])
    expect(profile.agents.sisyphus).toEqual({ model: 'openai/gpt-5.6' })
    expect(profile.disabled_mcps).toEqual(['websearch'])
    expect(once).toContain('// preserve user-owned route metadata')

    await installPreparedClients(
      preparedInstall(opencodePath, [{ id: 'coding-fast' }]),
      { env: { HOME: homeDirectory }, now: () => new Date(0) },
    )
    expect(readFileSync(profilePath, 'utf8')).toBe(once)
  })

  test('tightens an existing profile to 0600 after a managed update', async () => {
    const opencodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(opencodePath)
    mkdirSync(join(homeDirectory, '.config', 'opencode'), { recursive: true })
    writeFileSync(profilePath, '{}\n', { mode: 0o644 })

    await installPreparedClients(preparedInstall(opencodePath, [{ id: QWEN_GATEWAY_MODEL }]), {
      env: { HOME: homeDirectory },
      now: () => new Date(0),
    })

    if (process.platform !== 'win32') {
      expect(statSync(profilePath).mode & 0o777).toBe(0o600)
    }
  })
})

function preparedInstall(
  opencodeConfig: string,
  models: readonly { readonly id: string }[],
  search: readonly string[] = [],
): PreparedInstall {
  return {
    options: {
      target: InstallTarget.OpenCode,
      baseUrl: VALUE.gatewayOrigin,
      auth: InstallAuth.Environment,
      authEnv: VALUE.authEnv,
      nonInteractive: true,
      opencodeConfig,
      codexConfig: undefined,
      codexMode: CodexMode.Both,
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search,
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: search.length === 0,
      noMcp: false,
      noToolsets: false,
    },
    apiKey: 'test-api-key',
    discovery: {
      models,
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [],
    },
    selectionWarnings: [],
  }
}
