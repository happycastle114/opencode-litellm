import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import { prepareInstall } from '../src/cli/install-preparation'
import { AutoRouterMode } from '../src/cli/auto-router-contracts'
import { installPreparedClients } from '../src/cli/client-installer'
import { BUNDLED_CATALOG } from './client-installer-test-support'
import { readFileSync } from 'node:fs'
import { parse as parseToml } from 'smol-toml'
import { boundary, DISCOVERY, installOptions, VALUE, writeToken } from './install-preparation-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-interactive-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation interactive', () => {
  for (const mode of [CodexMode.HybridClient, CodexMode.HybridServer]) {
    test(`${mode} persists the interactive paid choice into the installed provider`, async () => {
      const answers = ['', '', '', '', '1', 'y']
      const prepared = await prepareInstall(installOptions({
        target: InstallTarget.Codex, codexMode: mode, auth: InstallAuth.Environment,
        autoRouter: AutoRouterMode.Skip, noSearch: true, noMcp: true, noToolsets: true,
      }), boundary(homeDirectory, {
        env: { HOME: homeDirectory, [VALUE.envName]: VALUE.apiKey },
        discover: async () => ({ ...DISCOVERY, models: [{ id: 'independent-team-alias' }] }),
        onboardingIO: {
          isTTY: true, write: (_message) => {},
          prompt: async () => {
            const answer = answers.shift()
            if (answer === undefined) throw new Error('Unexpected extra prompt')
            return answer
          },
        },
      }))
      expect(prepared.options.codexFallbackModel).toBe('independent-team-alias')
      await installPreparedClients(prepared, {
        env: { HOME: homeDirectory }, now: () => new Date(0),
        bundledCodexCatalog: () => BUNDLED_CATALOG,
      })
      const config = parseToml(readFileSync(join(homeDirectory, '.codex', 'config.toml'), 'utf8'))
      expect(config).toMatchObject({
        model: `auto/${BUNDLED_CATALOG.defaultModel}`,
        model_providers: { 'litellm-codex-hybrid': { http_headers: { 'x-codex-fallback-model': 'independent-team-alias' } } },
      })
    })
  }

  test('uses changed interactive choices before SSO and authenticated discovery', async () => {
    // Given: staged answers change the gateway before accepting all resources
    const answers = ['', `${VALUE.changedOrigin}/`, '', '', '', '', '', '', '', 'y']
    const writes: string[] = []
    let promptCount = 0
    let onboardedAt = -1
    let discoveredAt = -1
    const prepared = await prepareInstall(
      installOptions({ target: InstallTarget.Both, auth: InstallAuth.Sso }),
      boundary(homeDirectory, {
        onboardingIO: {
          isTTY: true,
          prompt: async () => {
            promptCount += 1
            return answers.shift() ?? ''
          },
          write: (message) => writes.push(message),
        },
        onboard: async (input) => {
          onboardedAt = promptCount
          expect(input.baseUrl).toBe(VALUE.changedOrigin)
          expect(input.tokenFilePath).toBe(join(homeDirectory, '.litellm', 'token.json'))
          writeToken(homeDirectory, VALUE.changedOrigin)
          return { status: 'authenticated' }
        },
        discover: async (input) => {
          discoveredAt = promptCount
          expect(input).toMatchObject({ origin: VALUE.changedOrigin, apiKey: VALUE.apiKey })
          return DISCOVERY
        },
      }),
    )

    // When/Then: auth/discovery run after connection choices and before resource prompts
    expect(onboardedAt).toBe(4)
    expect(discoveredAt).toBe(4)
    expect(prepared.options).toMatchObject({
      target: InstallTarget.Both,
      baseUrl: VALUE.changedOrigin,
      auth: InstallAuth.Sso,
      codexMode: CodexMode.Both,
      search: DISCOVERY.searchToolNames,
      mcp: DISCOVERY.mcpServerNames,
      toolsets: ['toolset-visible', 'toolset-second'],
    })
    expect(writes.join('\n')).not.toContain(VALUE.apiKey)
  })
})
