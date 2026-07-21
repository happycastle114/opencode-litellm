import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

const binaryPath = fileURLToPath(new URL('../dist/opencode-litellm.mjs', import.meta.url))

describe('bundled CLI binary', () => {
  test('is directly executable and exposes help through a supported Node runtime', () => {
    // Given: the package build has produced its public binary artifact
    accessSync(binaryPath, constants.X_OK)

    // When: the executable is invoked through its real public surface
    const result = spawnSync(binaryPath, ['doctor', '--help'], { encoding: 'utf8' })

    // Then: Node executes the ESM bundle successfully
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: opencode-litellm doctor [options]')
    expect(result.stderr).toBe('')
  })

  test('returns a concise nonzero error for an unknown command', () => {
    // Given: the bundled executable
    // When: an unsupported command is invoked
    const result = spawnSync(binaryPath, ['unknown'], { encoding: 'utf8' })

    // Then: the process fails without a stack trace
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      "Unknown command 'unknown'.\nRun 'opencode-litellm --help' for usage.\n",
    )
    expect(result.stderr).not.toContain('at ')
  })
})
