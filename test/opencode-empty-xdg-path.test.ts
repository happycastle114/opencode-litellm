import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { resolveOpenCodeConfigPath } from '../src/cli/paths'

describe('empty OpenCode XDG path', () => {
  test('falls back to HOME instead of the process working directory', () => {
    // Given: an explicitly empty XDG_CONFIG_HOME and a usable HOME
    // When: the default OpenCode destination is resolved
    const path = resolveOpenCodeConfigPath(undefined, {
      HOME: '/isolated/home',
      XDG_CONFIG_HOME: '',
    })

    // Then: the absolute HOME fallback wins over a cwd-relative opencode path
    expect(path).toBe('/isolated/home/.config/opencode/opencode.jsonc')
    expect(path).not.toBe(resolve('opencode', 'opencode.jsonc'))
  })
})
