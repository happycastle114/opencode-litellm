import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseJsonc } from 'jsonc-parser'
import { applyOpenCodeEdits, planOpenCodeEdits } from '../src/cli/opencode-config'
import {
  ManagedPluginCheckoutError,
  ensureManagedOpenCodePlugin,
  planManagedOpenCodePlugin,
} from '../src/cli/managed-plugin'

const MANAGED_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: 'f4b83a7fe53924751cf2453757faf9de79dbc630',
  checkoutDirectory: 'opencode-litellm-git',
  entrypoint: 'src/index.ts',
} as const
const COMMAND_RESULT = {
  correctOrigin: { exitCode: 0, stdout: `${MANAGED_PLUGIN.repository}\n`, stderr: '' },
  wrongOrigin: { exitCode: 0, stdout: 'https://attacker.example.test/plugin.git\n', stderr: '' },
  clean: { exitCode: 0, stdout: '', stderr: '' },
  dirty: { exitCode: 0, stdout: ' M src/index.ts\n', stderr: '' },
  unexpected: { exitCode: 127, stdout: '', stderr: 'unexpected command' },
} as const
const FULL_GIT_SHA = /^[0-9a-f]{40}$/
const BASE_INTENT = {
  baseUrl: 'https://llm.example.test',
  authEnv: 'OPENCODE_LITELLM_API_KEY',
  search: [],
  mcp: [],
  disableMcp: [],
} as const

type CommandInvocation = {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd?: string
}

function createBoundary(results: readonly (typeof COMMAND_RESULT)[keyof typeof COMMAND_RESULT][]) {
  const calls: CommandInvocation[] = []
  let index = 0
  return {
    calls,
    boundary: {
      fs: { exists: (_path: string) => true },
      command: {
        run: async (invocation: CommandInvocation) => {
          calls.push(invocation)
          const result = results[index]
          index += 1
          return result ?? COMMAND_RESULT.unexpected
        },
      },
    },
  }
}

describe('managed OpenCode plugin install plan', () => {
  test('uses a file URL for the managed checkout pinned to an exact full SHA', () => {
    // Given: an OpenCode config directory whose path requires URL encoding
    const opencodeConfigDir = join(tmpdir(), 'OpenCode Config')

    // When: the managed plugin install is planned
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })

    // Then: the checkout, entrypoint, and immutable revision are explicit
    const checkoutPath = join(opencodeConfigDir, 'vendor', MANAGED_PLUGIN.checkoutDirectory)
    const entrypointPath = join(checkoutPath, MANAGED_PLUGIN.entrypoint)
    expect(plan).toEqual({
      repository: MANAGED_PLUGIN.repository,
      revision: MANAGED_PLUGIN.revision,
      checkoutPath,
      entrypointPath,
      pluginSpec: pathToFileURL(entrypointPath).href,
    })
    expect(plan.revision).toMatch(FULL_GIT_SHA)
  })

  test('writes the managed file URL into the OpenCode plugin list', () => {
    // Given: a managed checkout plan
    const plan = planManagedOpenCodePlugin({
      opencodeConfigDir: join(tmpdir(), 'opencode'),
    })

    // When: OpenCode configuration edits consume that plan
    const intent = { ...BASE_INTENT, pluginSpec: plan.pluginSpec } as const
    const source = '{}'
    const output = applyOpenCodeEdits(source, planOpenCodeEdits(source, intent))

    // Then: the durable config references the managed checkout, not a registry selector
    expect(parseJsonc(output).plugin).toEqual([plan.pluginSpec])
  })

  test('rejects a checkout whose origin differs before update commands run', async () => {
    // Given: an existing checkout reporting a foreign origin
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([COMMAND_RESULT.wrongOrigin])

    // When/Then: checkout preparation fails closed at the origin boundary
    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toBeInstanceOf(
      ManagedPluginCheckoutError,
    )
    expect(fake.calls).toHaveLength(1)
  })

  test('rejects a dirty checkout before fetch or detached checkout', async () => {
    // Given: the correct origin with local modifications
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([COMMAND_RESULT.correctOrigin, COMMAND_RESULT.dirty])

    // When/Then: checkout preparation preserves local work and stops
    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toBeInstanceOf(
      ManagedPluginCheckoutError,
    )
    expect(fake.calls).toHaveLength(2)
  })
})
