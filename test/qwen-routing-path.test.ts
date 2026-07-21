import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOhMyOpenAgentProfilePath } from '../src/cli/qwen-routing'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createConfigDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'qwen-routing-path-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('Oh My OpenAgent profile path resolution', () => {
  test('prefers the existing canonical JSONC profile when canonical JSON also exists', () => {
    // Given: both canonical formats exist beside the OpenCode config
    const directory = createConfigDirectory()
    const opencodeConfigPath = join(directory, 'opencode.json')
    const jsoncPath = join(directory, 'oh-my-openagent.jsonc')
    writeFileSync(jsoncPath, '{}\n')
    writeFileSync(join(directory, 'oh-my-openagent.json'), '{}\n')

    // When: the managed profile path is resolved
    const resolved = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)

    // Then: the loader-preferred JSONC file is selected
    expect(resolved).toBe(jsoncPath)
  })

  test('uses the existing canonical JSON profile before a legacy JSONC profile', () => {
    // Given: canonical JSON and legacy JSONC profiles both exist
    const directory = createConfigDirectory()
    const opencodeConfigPath = join(directory, 'opencode.jsonc')
    const jsonPath = join(directory, 'oh-my-openagent.json')
    writeFileSync(jsonPath, '{}\n')
    writeFileSync(join(directory, 'oh-my-opencode.jsonc'), '{}\n')

    // When: the managed profile path is resolved
    const resolved = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)

    // Then: that existing canonical profile is selected
    expect(resolved).toBe(jsonPath)
  })

  test('uses the loader-preferred legacy JSONC profile when no canonical profile exists', () => {
    // Given: both legacy formats exist without a canonical profile
    const directory = createConfigDirectory()
    const opencodeConfigPath = join(directory, 'opencode.json')
    const legacyJsoncPath = join(directory, 'oh-my-opencode.jsonc')
    writeFileSync(legacyJsoncPath, '{}\n')
    writeFileSync(join(directory, 'oh-my-opencode.json'), '{}\n')

    // When: the managed profile path is resolved
    const resolved = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)

    // Then: the active legacy JSONC file is updated without creating an ignored sibling
    expect(resolved).toBe(legacyJsoncPath)
  })

  test('defaults to canonical JSON when no profile exists', () => {
    // Given: no canonical or legacy profile exists
    const directory = createConfigDirectory()
    const opencodeConfigPath = join(directory, 'opencode.jsonc')

    // When: the managed profile path is resolved
    const resolved = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)

    // Then: the upstream default canonical JSON path is selected
    expect(resolved).toBe(join(directory, 'oh-my-openagent.json'))
  })

  test('returns the same active path across repeated resolution', () => {
    // Given: an existing legacy JSON profile is the active loader target
    const directory = createConfigDirectory()
    const opencodeConfigPath = join(directory, 'opencode.json')
    const legacyJsonPath = join(directory, 'oh-my-opencode.json')
    writeFileSync(legacyJsonPath, '{}\n')

    // When: resolution is repeated without changing the filesystem
    const first = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)
    const second = resolveOhMyOpenAgentProfilePath(opencodeConfigPath)

    // Then: the resolver is stable and remains on the loader-visible file
    expect(first).toBe(legacyJsonPath)
    expect(second).toBe(first)
  })
})
