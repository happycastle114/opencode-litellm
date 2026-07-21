import { describe, expect, test } from 'bun:test'
import { parseAuthCommandOptions } from '../src/cli/auth-command-options'

describe('auth lifecycle command options', () => {
  test('uses the production gateway default', () => {
    expect(parseAuthCommandOptions([])).toEqual({
      ok: true,
      options: {
        baseUrl: 'https://llm.soungmin.kr',
        authEnv: 'LITELLM_PROXY_API_KEY',
      },
    })
  })

  test('normalizes an explicit gateway origin and accepts a custom auth environment', () => {
    expect(parseAuthCommandOptions([
      '--auth-env', 'CUSTOM_LITELLM_KEY',
      '--base-url', 'https://llm.example.test///',
    ])).toEqual({
      ok: true,
      options: {
        baseUrl: 'https://llm.example.test',
        authEnv: 'CUSTOM_LITELLM_KEY',
      },
    })
  })

  test.each([
    [['--unknown'], "Unknown auth option '--unknown'."],
    [['--base-url'], "Option '--base-url' requires a value."],
    [['--base-url', 'invalid'], "Option '--base-url' must be an absolute http(s) origin."],
    [['--auth-env', '9INVALID'], "Option '--auth-env' must be a valid environment variable name."],
    [['--base-url', 'https://llm.example.test', 'extra'], "Unknown auth option 'extra'."],
    [['--base-url', 'https://one.test', '--base-url', 'https://two.test'], "Option '--base-url' may be specified only once."],
  ] as const)('rejects malformed arguments %j', (argv, message) => {
    expect(parseAuthCommandOptions(argv)).toEqual({ ok: false, message })
  })
})
