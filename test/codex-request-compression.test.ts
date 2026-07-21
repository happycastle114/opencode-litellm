import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { CLIENT_INSTALL_ASSET_OPERATION } from '../src/cli/client-install-assets'
import {
  prepareCodexInstall,
  type CodexInstallPlan,
} from '../src/cli/client-installer-codex-plan'
import {
  renderCodexConfig,
  renderCodexOAuthConfig,
} from '../src/cli/codex-config'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import { CODEX_FEATURE_KEY } from '../src/cli/codex-request-compression'
import type { PreparedInstall } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault } from '../src/cli/install-intent'

const HOME_DIRECTORY = '/tmp/codex-request-compression-home'
const CONFIG_PATH = join(HOME_DIRECTORY, '.codex', 'config.toml')
const OAUTH_PROFILE_PATH = join(HOME_DIRECTORY, '.codex', 'codex-oauth.config.toml')
const FEATURE_KEY = CODEX_FEATURE_KEY.EnableRequestCompression
const bundledCatalog = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})

const gatewayIntent = {
  baseUrl: 'https://litellm.example.test',
  authEnv: 'LITELLM_PROXY_API_KEY',
  authCommand: '/tmp/litellm-auth-token.mjs',
  includeOAuthProvider: false,
  catalogPath: '/tmp/litellm-models.json',
  defaultModel: 'gateway-model',
  mcp: [],
  disableMcp: [],
} as const

const oauthIntent = {
  baseUrl: gatewayIntent.baseUrl,
  authEnv: gatewayIntent.authEnv,
  catalogPath: '/tmp/litellm-codex-oauth-models.json',
  defaultModel: bundledCatalog.defaultModel,
} as const

describe('Codex OAuth request compression compatibility', () => {
  test('disables compression in OAuth config while preserving other features', () => {
    // Given: a user feature table with an explicit compression preference
    const source = '[features]\nmulti_agent_v2 = true\nenable_request_compression = true # user preference\n'

    // When: the OAuth config is rendered twice
    const once = renderCodexOAuthConfig(source, oauthIntent)
    const twice = renderCodexOAuthConfig(once, oauthIntent)
    const features = parseToml(once).features

    // Then: OAuth is uncompressed, unrelated features survive, and ownership is idempotent
    expect(features).toMatchObject({
      multi_agent_v2: true,
      [FEATURE_KEY]: false,
    })
    expect(twice).toBe(once)
  })

  test('restores a user compression preference when OAuth transitions to gateway', () => {
    // Given: OAuth temporarily overrides a user-owned feature value
    const source = '[features]\nenable_request_compression = true # user preference\n'
    const oauth = renderCodexOAuthConfig(source, oauthIntent)

    // When: the same main config transitions to gateway mode
    const gateway = renderCodexConfig(oauth, gatewayIntent)

    // Then: the user value and comment return without a stale managed marker
    expect(parseToml(gateway).features).toEqual({ [FEATURE_KEY]: true })
    expect(gateway).toContain('enable_request_compression = true # user preference')
    expect(gateway).not.toContain('opencode-litellm-oauth-request-compression')
  })

  test('removes an installer-only compression setting on OAuth to gateway transition', () => {
    // Given: OAuth adds compression ownership to a config with no feature table
    const oauth = renderCodexOAuthConfig('approval_policy = "never"\n', oauthIntent)

    // When: the main config transitions to gateway mode
    const gateway = renderCodexConfig(oauth, gatewayIntent)

    // Then: no stale feature key or empty managed feature table remains
    const parsed = parseToml(gateway)
    expect(parsed.approval_policy).toBe('never')
    expect(parsed.features).toBeUndefined()
    expect(gateway).not.toContain(FEATURE_KEY)
  })

  test.each([
    [CodexMode.Gateway, undefined, undefined],
    [CodexMode.OAuth, false, undefined],
    [CodexMode.Both, undefined, false],
  ] as const)(
    'writes request compression only to the OAuth-active file in %s mode',
    (mode, expectedMain, expectedProfile) => {
      // Given: an install plan for one typed Codex mode
      const prepared = preparedInstall(mode)

      // When: Codex assets are planned
      const plan = prepareCodexInstall(prepared, {
        env: { HOME: HOME_DIRECTORY },
        bundledCodexCatalog: () => bundledCatalog,
      }, HOME_DIRECTORY)
      const main = parseToml(writeContents(plan, CONFIG_PATH))
      const profile = mode === CodexMode.Both
        ? parseToml(writeContents(plan, OAUTH_PROFILE_PATH))
        : undefined

      // Then: only a config that can send native OAuth requests disables compression
      expect(main.features?.[FEATURE_KEY]).toBe(expectedMain)
      expect(profile?.features?.[FEATURE_KEY]).toBe(expectedProfile)
    },
  )
})

function preparedInstall(mode: CodexMode): PreparedInstall {
  return {
    options: {
      target: InstallTarget.Codex,
      baseUrl: gatewayIntent.baseUrl,
      auth: InstallAuth.Environment,
      authEnv: gatewayIntent.authEnv,
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: CONFIG_PATH,
      codexMode: mode,
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: [],
      disableMcp: [],
      noSearch: true,
      noMcp: true,
      noToolsets: true,
    },
    apiKey: 'test-only-key',
    discovery: {
      models: [{ id: 'gateway-model' }],
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [],
    },
    selectionWarnings: [],
  }
}

function writeContents(plan: CodexInstallPlan, path: string): string {
  const asset = plan.assets.find((candidate) => candidate.path === path)
  if (asset?.operation !== CLIENT_INSTALL_ASSET_OPERATION.Write) {
    throw new Error(`Expected a managed write asset at ${path}.`)
  }
  return asset.contents
}
