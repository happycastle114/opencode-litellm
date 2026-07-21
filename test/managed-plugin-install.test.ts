import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  OH_MY_OPENAGENT_PLUGIN_SPEC,
  applyOpenCodeEdits,
  planOpenCodeEdits,
} from '../src/cli/opencode-config'
import { planManagedOpenCodePlugin } from '../src/cli/managed-plugin'
import {
  BASE_INTENT,
  FULL_GIT_SHA,
  MANAGED_PLUGIN,
} from './managed-plugin-test-support'

describe('managed OpenCode plugin install plan', () => {
  test('uses a file URL for the managed checkout pinned to an exact full SHA', () => {
    // Given: an OpenCode config directory whose path requires URL encoding
    const opencodeConfigDir = join(tmpdir(), 'OpenCode Config')

    // When: the managed plugin install is planned
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })

    // Then: the checkout, entrypoint, and immutable revision are explicit
    const checkoutPath = join(
      opencodeConfigDir,
      'vendor',
      MANAGED_PLUGIN.checkoutDirectory,
      MANAGED_PLUGIN.revision,
    )
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
    expect(parseJsonc(output).plugin).toEqual([plan.pluginSpec, OH_MY_OPENAGENT_PLUGIN_SPEC])
  })
})
