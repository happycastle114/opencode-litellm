import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCliArgs } from '../src/cli/command'
import { ReservedAuthEnvironment, ToolkitDefault } from '../src/cli/install-intent'
import { runCliProgram } from '../src/cli/program'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'auth-environment-policy-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('auth environment collision policy', () => {
  test.each([
    ReservedAuthEnvironment.OpenAIApiKey,
    ReservedAuthEnvironment.CodexApiKey,
    ReservedAuthEnvironment.AnthropicApiKey,
    ReservedAuthEnvironment.AnthropicAuthToken,
  ] as const)(
    'rejects provider authentication environment %s as a gateway admission key',
    (authEnvironment) => {
      // Given: a provider credential variable whose child-process meaning is reserved
      // When: install arguments are parsed
      const parsed = parseCliArgs(['install', '--auth-env', authEnvironment])

      // Then: the client authentication precedence cannot be repurposed
      expect(parsed.kind).toBe('error')
    },
  )

  test.each([
    ToolkitDefault.AuthEnvironment,
    'LITELLM_API_KEY',
    'CUSTOM_GATEWAY_KEY',
  ] as const)(
    'allows neutral gateway credential environment %s',
    (authEnvironment) => {
      // Given: a default or custom variable without client authentication semantics
      // When: install arguments are parsed
      const parsed = parseCliArgs(['install', '--auth-env', authEnvironment])

      // Then: the neutral variable remains available for gateway admission
      expect(parsed.kind).toBe('command')
      if (parsed.kind !== 'command') return
      expect(parsed.options.authEnv).toBe(authEnvironment)
    },
  )

  test.each(Object.values(ReservedAuthEnvironment))(
    'rejects reserved launcher environment %s as an auth credential name',
    (authEnvironment) => {
      // Given: an auth environment owned by the launcher or process runtime
      // When: install arguments are parsed
      const parsed = parseCliArgs(['install', '--auth-env', authEnvironment])

      // Then: the environment collision is rejected at the CLI boundary
      expect(parsed).toEqual({
        kind: 'error',
        message: `Invalid value '${authEnvironment}' for '--auth-env'.`,
      })
    },
  )

  test('rejects a reserved environment before changing client or launch state', async () => {
    // Given: sentinel client and launcher files plus a reserved auth environment
    const opencodePath = join(homeDirectory, 'opencode.jsonc')
    const codexPath = join(homeDirectory, 'codex', 'config.toml')
    const launchPath = join(homeDirectory, '.config', 'opencode-litellm', 'launch.json')
    mkdirSync(join(homeDirectory, 'codex'), { recursive: true })
    mkdirSync(join(homeDirectory, '.config', 'opencode-litellm'), { recursive: true })
    writeFileSync(opencodePath, '{"keep":true}\n')
    writeFileSync(codexPath, 'approval_policy = "on-request"\n')
    writeFileSync(launchPath, '{"sentinel":true}\n')

    // When: a both-client install tries to use a launcher-owned variable as its key
    const result = await runCliProgram([
      'install', '--target', 'both', '--base-url', 'https://custom.example.com',
      '--auth', 'env', '--auth-env', ReservedAuthEnvironment.OpenAIApiKey,
      '--opencode-config', opencodePath, '--codex-config', codexPath, '--non-interactive',
    ], {
      env: { HOME: homeDirectory, [ReservedAuthEnvironment.OpenAIApiKey]: 'invalid-key' },
      now: () => new Date(0),
      gatewayDiscovery: async () => {
        throw new Error('discovery should not run for invalid install options')
      },
    })

    // Then: parsing fails and no persisted state changes
    expect(result.exitCode).toBe(2)
    expect(readFileSync(opencodePath, 'utf8')).toBe('{"keep":true}\n')
    expect(readFileSync(codexPath, 'utf8')).toBe('approval_policy = "on-request"\n')
    expect(readFileSync(launchPath, 'utf8')).toBe('{"sentinel":true}\n')
  })
})
