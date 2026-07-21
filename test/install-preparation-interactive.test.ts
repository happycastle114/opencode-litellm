import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import { prepareInstall } from '../src/cli/install-preparation'
import { boundary, DISCOVERY, installOptions, VALUE, writeToken } from './install-preparation-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-interactive-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation interactive', () => {
  test('uses changed interactive choices before SSO and authenticated discovery', async () => {
    // Given: staged answers change the gateway before accepting all resources
    const answers = ['', `${VALUE.changedOrigin}/`, '', '', '', '', '', 'y']
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
