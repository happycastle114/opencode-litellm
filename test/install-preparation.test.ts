import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InstallAuth } from '../src/cli/install-intent'
import { prepareInstall } from '../src/cli/install-preparation'
import {
  boundary,
  DISCOVERY,
  installOptions,
  VALUE,
} from './install-preparation-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation', () => {
  test('auto-selects every available gateway resource for empty non-interactive flags', async () => {
    // Given: environment authentication and no explicit resource filters
    const options = installOptions({ auth: InstallAuth.Environment, nonInteractive: true })
    const calls: Array<{ readonly origin: string; readonly apiKey: string }> = []

    // When: the canonical preparation boundary runs
    const prepared = await prepareInstall(options, boundary(homeDirectory, {
      env: { HOME: homeDirectory, [VALUE.envName]: VALUE.apiKey },
      discover: async (input) => {
        calls.push({ origin: input.origin, apiKey: input.apiKey })
        return DISCOVERY
      },
    }))

    // Then: discovery is authenticated and every visible resource is selected
    expect(calls).toEqual([{ origin: VALUE.defaultOrigin, apiKey: VALUE.apiKey }])
    expect(prepared.options).toMatchObject({
      baseUrl: VALUE.defaultOrigin,
      search: DISCOVERY.searchToolNames,
      mcp: DISCOVERY.mcpServerNames,
      toolsets: ['toolset-visible', 'toolset-second'],
    })
    expect(prepared.discovery).toBe(DISCOVERY)
    expect(prepared.apiKey).toBe(VALUE.apiKey)
    expect(prepared.selectionWarnings).toEqual([])
  })
})
