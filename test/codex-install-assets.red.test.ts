import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { runCliProgram } from '../src/cli/program'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'

const PROVIDER_ID = {
  GatewaySso: 'litellm-gateway-sso',
  CodexOAuth: 'litellm-codex-oauth',
} as const

const ENDPOINT = {
  Models: '/v1/models',
  McpServers: '/v1/mcp/server',
} as const

const DISCOVERED = {
  Model: 'gateway/dynamic-model',
  McpServer: 'research_docs',
} as const

const GATEWAY_ORIGIN = 'https://litellm.example.com'
const BUNDLED_CATALOG = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})
const originalFetch = globalThis.fetch

let home: string
let configPath: string
let requests: string[]

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'codex-litellm-install-'))
  configPath = join(home, '.codex', 'config.toml')
  requests = []
  const tokenDirectory = join(home, '.litellm')
  mkdirSync(tokenDirectory, { recursive: true })
  writeFileSync(join(tokenDirectory, 'token.json'), JSON.stringify({
    base_url: GATEWAY_ORIGIN,
    key: 'test-proxy-key',
  }))
  const responses = new Map<string, unknown>([
      [ENDPOINT.Models, {
        object: 'list',
        data: [{ id: DISCOVERED.Model, object: 'model' }],
      }],
      [ENDPOINT.McpServers, [
        { server_name: DISCOVERED.McpServer },
      ]],
  ])
  globalThis.fetch = async (input) => {
    const url = input instanceof Request
      ? input.url
      : input instanceof URL ? input.href : input
    const endpoint = new URL(url).pathname
    requests.push(endpoint)
    const payload = responses.get(endpoint)
    return payload === undefined
      ? new Response(null, { status: 404 })
      : Response.json(payload)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  rmSync(home, { recursive: true, force: true })
})

describe('Codex clean-home installation', () => {
  test('discovers models and MCP servers before writing managed configuration', async () => {
    // Given: a clean home and a gateway with dynamic model and MCP catalogs
    // When: Codex installation runs through the public command surface
    const result = await installCodex()

    // Then: both discovery endpoints shape picker and MCP configuration
    expect(result.exitCode).toBe(0)
    expect(requests).toContain(ENDPOINT.Models)
    expect(requests).toContain(ENDPOINT.McpServers)
    const config = parseToml(readFileSync(configPath, 'utf8'))
    const catalog: unknown = JSON.parse(readFileSync(config.model_catalog_json, 'utf8'))
    expect(catalog).toHaveProperty('models.0.slug', DISCOVERED.Model)
    expect(config.mcp_servers).toHaveProperty(
      'litellm_research_docs.url',
      `${GATEWAY_ORIGIN}/${DISCOVERED.McpServer}/mcp`,
    )
  })

  test('writes a separate ChatGPT-login profile for Codex OAuth', async () => {
    // Given: a clean Codex home
    // When: Codex installation completes
    const result = await installCodex()

    // Then: the named profile selects only the OAuth provider and login method
    expect(result.exitCode).toBe(0)
    const profilePath = join(dirname(configPath), 'codex-oauth.config.toml')
    expect(existsSync(profilePath)).toBe(true)
    const profile = parseToml(readFileSync(profilePath, 'utf8'))
    expect(profile.model_provider).toBe(PROVIDER_ID.CodexOAuth)
    expect(profile.forced_login_method).toBe('chatgpt')
    const base = parseToml(readFileSync(configPath, 'utf8'))
    expect(base.model_provider).toBe(PROVIDER_ID.GatewaySso)
  })

  test('installs the research-router skill into the shared agent registry', async () => {
    // Given: a clean shared skill registry
    // When: Codex installation completes
    const result = await installCodex()

    // Then: the packaged skill is discoverable by its machine-readable name
    expect(result.exitCode).toBe(0)
    const skillPath = researchSkillPath()
    expect(existsSync(skillPath)).toBe(true)
    expect(readFileSync(skillPath, 'utf8')).toMatch(
      /^name:\s*litellm-research-router\s*$/m,
    )
  })

  test('reinstall is byte-stable and preserves unrelated skills', async () => {
    // Given: one completed install and a user-owned neighboring skill
    const unrelatedPath = join(home, '.agents', 'skills', 'user-owned', 'SKILL.md')
    mkdirSync(dirname(unrelatedPath), { recursive: true })
    const unrelatedSource = '---\nname: user-owned\n---\n'
    writeFileSync(unrelatedPath, unrelatedSource)
    const firstResult = await installCodex()
    expect(firstResult.exitCode).toBe(0)
    expect(existsSync(researchSkillPath())).toBe(true)
    const firstSkill = readFileSync(researchSkillPath(), 'utf8')

    // When: the same installation is applied again
    const secondResult = await installCodex()

    // Then: managed and unrelated skill bytes remain stable
    expect(secondResult.exitCode).toBe(0)
    expect(readFileSync(researchSkillPath(), 'utf8')).toBe(firstSkill)
    expect(readFileSync(unrelatedPath, 'utf8')).toBe(unrelatedSource)
  })
})

async function installCodex() {
  return runCliProgram([
    'install',
    '--target',
    'codex',
    '--base-url',
    GATEWAY_ORIGIN,
    '--auth',
    'sso',
    '--auth-env',
    'LITELLM_PROXY_API_KEY',
    '--codex-config',
    configPath,
    '--non-interactive',
  ], {
    env: { HOME: home, LITELLM_PROXY_API_KEY: 'test-proxy-key' },
    now: () => new Date(0),
    bundledCodexCatalog: () => BUNDLED_CATALOG,
  })
}

function researchSkillPath(): string {
  return join(home, '.agents', 'skills', 'litellm-research-router', 'SKILL.md')
}
