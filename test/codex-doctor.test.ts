import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CodexDoctorCheckCode, inspectCodexConfig } from '../src/cli/doctor'

const PROVIDER = {
  Environment: 'litellm',
  Sso: 'litellm-gateway-sso',
  OAuth: 'litellm-codex-oauth',
} as const

const MODEL = {
  Gateway: 'coding-fast',
  OAuth: 'gpt-test',
} as const

let root: string
let configPath: string
let profilePath: string
let baseCatalogPath: string
let oauthCatalogPath: string
let helperPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-litellm-doctor-'))
  configPath = join(root, 'config.toml')
  profilePath = join(root, 'codex-oauth.config.toml')
  baseCatalogPath = join(root, 'litellm-models.json')
  oauthCatalogPath = join(root, 'litellm-codex-oauth-models.json')
  helperPath = join(root, 'libexec', 'litellm-auth-token.mjs')
  writeHealthyInstallation()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('doctor Codex inspection', () => {
  test('accepts generated SSO, OAuth, catalog, and helper assets', () => {
    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('ok')
    expect(report.checks.every((entry) => entry.status === 'ok')).toBe(true)
    expect(report.checks.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      CodexDoctorCheckCode.BaseAuth,
      CodexDoctorCheckCode.Helper,
      CodexDoctorCheckCode.BaseCatalog,
      CodexDoctorCheckCode.OAuthAuth,
      CodexDoctorCheckCode.OAuthCatalog,
      CodexDoctorCheckCode.Secrets,
    ]))
  })

  test('accepts a gateway-only SSO config without an OAuth profile', () => {
    rmSync(profilePath)
    rmSync(oauthCatalogPath)

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('ok')
    expect(findCheck(report, CodexDoctorCheckCode.OAuthFile).status).toBe('ok')
  })

  test('accepts a gateway-only environment provider without a helper or OAuth profile', () => {
    writeFileSync(configPath, baseConfig(`
[model_providers.${PROVIDER.Environment}]
name = "LiteLLM"
base_url = "https://llm.example.com/v1"
env_key = "LITELLM_PROXY_API_KEY"
wire_api = "responses"
`, PROVIDER.Environment))
    rmSync(profilePath)
    rmSync(oauthCatalogPath)
    rmSync(helperPath)

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('ok')
  })

  test('accepts OAuth as the main config without a helper or secondary profile', () => {
    writeFileSync(configPath, oauthProfile())
    rmSync(profilePath)
    rmSync(helperPath)

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('ok')
    expect(findCheck(report, CodexDoctorCheckCode.OAuthAuth).status).toBe('ok')
    expect(findCheck(report, CodexDoctorCheckCode.BaseCatalog).status).toBe('ok')
  })

  test('accepts the environment-backed base provider as one exclusive auth source', () => {
    writeFileSync(configPath, baseConfig(`
[model_providers.${PROVIDER.Environment}]
name = "LiteLLM"
base_url = "https://llm.example.com/v1"
env_key = "LITELLM_PROXY_API_KEY"
wire_api = "responses"
` , PROVIDER.Environment))

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('ok')
  })

  test('rejects multiple authentication sources on the base provider', () => {
    const source = baseConfig(`
[model_providers.${PROVIDER.Sso}]
name = "LiteLLM Gateway SSO"
base_url = "https://llm.example.com/v1"
env_key = "LITELLM_PROXY_API_KEY"
wire_api = "responses"

[model_providers.${PROVIDER.Sso}.auth]
command = ${JSON.stringify(helperPath)}
`)
    writeFileSync(configPath, source)

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('error')
    expect(findCheck(report, CodexDoctorCheckCode.BaseAuth).status).toBe('error')
  })

  test('requires ChatGPT OAuth and an environment-backed LiteLLM header in the profile', () => {
    writeFileSync(profilePath, oauthProfile()
      .replace('requires_openai_auth = true', 'requires_openai_auth = false')
      .replace('"LITELLM_PROXY_API_KEY"', '"sk-plaintext-proxy-key"'))

    const report = inspectCodexConfig(configPath)

    expect(report.status).toBe('error')
    expect(findCheck(report, CodexDoctorCheckCode.OAuthAuth).status).toBe('error')
    expect(JSON.stringify(report)).not.toContain('sk-plaintext-proxy-key')
  })

  test('reports missing helper and model catalog files', () => {
    rmSync(helperPath)
    rmSync(baseCatalogPath)

    const report = inspectCodexConfig(configPath)

    expect(findCheck(report, CodexDoctorCheckCode.Helper).status).toBe('error')
    expect(findCheck(report, CodexDoctorCheckCode.BaseCatalog).status).toBe('error')
  })

  test('rejects malformed profile TOML and catalog JSON without throwing', () => {
    writeFileSync(profilePath, '[model_providers.')
    writeFileSync(baseCatalogPath, '{"models":[')

    const report = inspectCodexConfig(configPath)

    expect(findCheck(report, CodexDoctorCheckCode.OAuthSyntax).status).toBe('error')
    expect(findCheck(report, CodexDoctorCheckCode.BaseCatalog).status).toBe('error')
  })

  test('rejects plaintext credential fields without exposing their values', () => {
    const secret = 'sk-sensitive-doctor-fixture'
    writeFileSync(configPath, baseConfig(`
[model_providers.${PROVIDER.Sso}]
name = "LiteLLM Gateway SSO"
base_url = "https://llm.example.com/v1"
api_key = ${JSON.stringify(secret)}
wire_api = "responses"

[model_providers.${PROVIDER.Sso}.auth]
command = ${JSON.stringify(helperPath)}
`))

    const report = inspectCodexConfig(configPath)

    expect(findCheck(report, CodexDoctorCheckCode.Secrets).status).toBe('error')
    expect(JSON.stringify(report)).not.toContain(secret)
  })
})

function writeHealthyInstallation(): void {
  mkdirSync(dirname(helperPath), { recursive: true })
  writeFileSync(helperPath, '#!/usr/bin/env node\n')
  writeFileSync(baseCatalogPath, catalog(MODEL.Gateway))
  writeFileSync(oauthCatalogPath, catalog(MODEL.OAuth))
  writeFileSync(configPath, baseConfig(`
[model_providers.${PROVIDER.Sso}]
name = "LiteLLM Gateway SSO"
base_url = "https://llm.example.com/v1"
wire_api = "responses"

[model_providers.${PROVIDER.Sso}.auth]
command = ${JSON.stringify(helperPath)}
`))
  writeFileSync(profilePath, oauthProfile())
}

function baseConfig(provider: string, selectedProvider = PROVIDER.Sso): string {
  return `model = "${MODEL.Gateway}"
model_provider = "${selectedProvider}"
model_catalog_json = ${JSON.stringify(baseCatalogPath)}
${provider.trim()}
`
}

function oauthProfile(): string {
  return `model = "${MODEL.OAuth}"
model_provider = "${PROVIDER.OAuth}"
model_catalog_json = ${JSON.stringify(oauthCatalogPath)}
forced_login_method = "chatgpt"

[model_providers.${PROVIDER.OAuth}]
name = "LiteLLM Gateway via ChatGPT OAuth"
base_url = "https://llm.example.com/codex-oauth"
wire_api = "responses"
requires_openai_auth = true
env_http_headers = { "x-litellm-api-key" = "LITELLM_PROXY_API_KEY" }
`
}

function catalog(model: string): string {
  return `${JSON.stringify({ models: [{ slug: model, visibility: 'list' }] }, null, 2)}\n`
}

function findCheck(
  report: ReturnType<typeof inspectCodexConfig>,
  code: typeof CodexDoctorCheckCode[keyof typeof CodexDoctorCheckCode],
) {
  const entry = report.checks.find((candidate) => candidate.code === code)
  if (entry === undefined) throw new Error(`Missing doctor check ${code}`)
  return entry
}
