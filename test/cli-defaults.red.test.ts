import { describe, expect, test } from 'bun:test'
import { applyBinaryDefaults, parseCliArgs, runCli } from '../src/cli/command'

const CLIENT_BIN = {
  OpenCode: '/tmp/bin/opencode-litellm',
  Codex: '/tmp/bin/codex-litellm',
} as const

const DEFAULTS = {
  GatewayOrigin: 'https://llm.soungmin.kr',
  Auth: 'sso',
  AuthEnv: 'LITELLM_PROXY_API_KEY',
} as const

describe('client-aware install defaults', () => {
  test.each([
    [CLIENT_BIN.OpenCode, 'opencode'],
    [CLIENT_BIN.Codex, 'codex'],
  ] as const)('selects %s target from its public bin', (bin, target) => {
    expect(applyBinaryDefaults(['install'], bin)).toEqual([
      'install', '--target', target,
    ])
  })

  test('preserves an explicit target across either bin alias', () => {
    const argv = ['install', '--target', 'both'] as const
    expect(applyBinaryDefaults(argv, CLIENT_BIN.Codex)).toEqual(argv)
  })

  test.each(['--help', '-h'] as const)(
    'preserves install %s so the built binary reaches command help',
    (help) => {
      const argv = ['install', help] as const
      expect(applyBinaryDefaults(argv, CLIENT_BIN.OpenCode)).toEqual(argv)
      expect(applyBinaryDefaults(argv, CLIENT_BIN.Codex)).toEqual(argv)
    },
  )

  test('makes a bare install a complete SSO-backed toolkit intent', () => {
    const parsed = parseCliArgs(['install'])
    expect(parsed.kind).toBe('command')
    if (parsed.kind !== 'command') return
    expect(parsed.options).toMatchObject({
      target: 'opencode',
      baseUrl: DEFAULTS.GatewayOrigin,
      auth: DEFAULTS.Auth,
      authEnv: DEFAULTS.AuthEnv,
      codexMode: 'both',
      search: [],
      mcp: [],
      toolsets: [],
      enableMcp: [],
      noSearch: false,
      noMcp: false,
      noToolsets: false,
    })
  })

  test('documents built-in LiteLLM lifecycle and direct agent launch commands', () => {
    const help = runCli([]).stdout
    for (const command of ['login', 'logout', 'whoami', 'claude', 'codex', 'opencode']) {
      expect(help).toContain(command)
    }
  })
})
