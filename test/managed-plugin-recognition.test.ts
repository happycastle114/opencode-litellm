import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  isManagedOpenCodePluginSpec,
} from '../src/cli/managed-plugin'
import { MANAGED_PLUGIN } from './managed-plugin-test-support'

describe('managed OpenCode plugin recognition', () => {
  test('recognizes legacy and full-SHA managed file specs only', () => {
    const configDir = join(tmpdir(), 'opencode')
    const legacySpec = pathToFileURL(
      join(configDir, 'vendor', MANAGED_PLUGIN.checkoutDirectory, MANAGED_PLUGIN.entrypoint),
    ).href
    const exactSpec = pathToFileURL(
      join(
        configDir,
        'vendor',
        MANAGED_PLUGIN.checkoutDirectory,
        MANAGED_PLUGIN.revision,
        MANAGED_PLUGIN.entrypoint,
      ),
    ).href

    expect(isManagedOpenCodePluginSpec(legacySpec)).toBe(true)
    expect(isManagedOpenCodePluginSpec(exactSpec)).toBe(true)
    expect(isManagedOpenCodePluginSpec(
      exactSpec.replace(MANAGED_PLUGIN.revision, 'not-a-sha'),
    )).toBe(false)
    expect(isManagedOpenCodePluginSpec(
      exactSpec.replace('file://', 'https://'),
    )).toBe(false)
    expect(isManagedOpenCodePluginSpec('file:///tmp/unrelated/src/index.ts')).toBe(false)
  })
})
