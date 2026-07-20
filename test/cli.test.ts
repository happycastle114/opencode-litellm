import { describe, expect, test } from 'bun:test'
import {
  needsNodeOnboardingBoundary,
  parseCliArgs,
  runCli,
} from '../src/cli/command'

const GLOBAL_HELP = `Usage: opencode-litellm <command> [options]

Commands:
  install  Configure supported clients for LiteLLM
  doctor   Check the local LiteLLM integration
  login    Sign in with the built-in LiteLLM SSO onboarding flow
  logout   Remove the local LiteLLM SSO session
  whoami   Show safe local LiteLLM SSO session metadata
  claude   Launch Claude Code with OAuth-safe LiteLLM routing
  codex    Launch Codex with the installed LiteLLM profile
  opencode Launch OpenCode with the installed LiteLLM toolkit

Options:
  --target <opencode|codex|both>  Client target
  --base-url <url>                LiteLLM gateway origin
  --auth <sso|env>                Gateway authentication
  --auth-env <name>               Gateway key environment variable
  --codex-mode <gateway|oauth|both> Codex connection mode
  --search <name>                 Select an authorized search tool (repeatable)
  --mcp <name>                    Select an authorized MCP server (repeatable)
  --toolset <name>                Select an authorized MCP toolset (repeatable)
  --no-search                     Disable search tool registration
  --no-mcp                        Disable MCP server registration
  --no-toolsets                   Disable MCP toolset registration
  --non-interactive               Accept explicit values and discovery defaults
  -h, --help                      Show help
`

const INSTALL_HELP = `Usage: opencode-litellm install [options]

Configure supported clients for LiteLLM.

Options:
  -h, --help  Show help
`

const DOCTOR_HELP = `Usage: opencode-litellm doctor [options]

Check the local LiteLLM integration.

Options:
  -h, --help  Show help
`

const AUTH_HELP = `Usage: opencode-litellm <login|logout|whoami> [options]

Manage the built-in LiteLLM CLI-compatible SSO session.

Options:
  --base-url <url>  LiteLLM gateway origin
  --auth-env <name> Codex OAuth admission-key environment name
  -h, --help        Show help
`

const AGENT_HELP = `Usage: opencode-litellm <claude|codex|opencode> [args...]

Launch an agent with the installed LiteLLM toolkit while keeping credentials in memory.

Options:
  -h, --help  Show help; other arguments are forwarded to the agent
`

describe('CLI argument parsing', () => {
  test('parses install into a typed invocation with production defaults', () => {
    const parsed = parseCliArgs(['install'])

    expect(parsed).toEqual({
      kind: 'command',
      command: 'install',
      help: false,
      options: {
        target: 'opencode',
        baseUrl: 'https://llm.soungmin.kr',
        auth: 'sso',
        authEnv: 'LITELLM_PROXY_API_KEY',
        nonInteractive: false,
        opencodeConfig: undefined,
        codexConfig: undefined,
        codexMode: 'both',
        search: [],
        mcp: [],
        toolsets: [],
        disableMcp: [],
        noSearch: false,
        noMcp: false,
        noToolsets: false,
      },
    })
  })

  test('parses doctor into a typed invocation with both-client defaults', () => {
    const parsed = parseCliArgs(['doctor'])

    expect(parsed).toEqual({
      kind: 'command',
      command: 'doctor',
      help: false,
      options: {
        target: 'both',
        json: false,
        opencodeConfig: undefined,
        codexConfig: undefined,
      },
    })
  })

  test.each(['login', 'logout', 'whoami', 'claude', 'codex', 'opencode'] as const)(
    'recognizes the owned %s lifecycle or launch command',
    (command) => {
      const parsed = parseCliArgs([command])

      expect(parsed).toEqual({
        kind: 'command',
        command,
        help: false,
        passthroughArgs: [],
      })
    },
  )

  test('preserves agent arguments for the direct launch boundary', () => {
    expect(parseCliArgs(['codex', '--model', 'gpt-5.6-sol', 'resume'])).toEqual({
      kind: 'command',
      command: 'codex',
      help: false,
      passthroughArgs: ['--model', 'gpt-5.6-sol', 'resume'],
    })
  })

  test('does not retain the obsolete exec stub', () => {
    expect(parseCliArgs(['exec'])).toEqual({
      kind: 'error',
      message: "Unknown command 'exec'.",
    })
  })

  test('recognizes command help without executing the command', () => {
    // Given: a supported command followed by its help option
    // When: the process arguments are parsed
    const parsed = parseCliArgs(['install', '--help'])

    // Then: help is recorded on the command invocation
    expect(parsed).toEqual({ kind: 'command', command: 'install', help: true })
  })

  test.each([
    [['unknown'], "Unknown command 'unknown'."],
    [['--unknown'], "Unknown option '--unknown'."],
    [['install', '--unknown'], "Unknown option '--unknown' for command 'install'."],
    [['install', 'extra'], "Unexpected argument 'extra' for command 'install'."],
  ])('rejects invalid arguments without throwing: %j', (argv, message) => {
    // Given: invalid command-line arguments
    // When: the process arguments are parsed
    const parsed = parseCliArgs(argv)

    // Then: parsing returns a deterministic error value
    expect(parsed).toEqual({ kind: 'error', message })
  })
})

describe('CLI command runner', () => {
  test.each([
    [['install'], true],
    [['install', '--non-interactive'], false],
    [['install', '--help'], false],
    [['login'], true],
    [['login', '--help'], false],
    [['codex'], false],
  ] as const)('creates terminal ownership only for interactive flows: %j', (argv, expected) => {
    expect(needsNodeOnboardingBoundary(argv)).toBe(expected)
  })

  test('prints the global help contract', () => {
    // Given: the global help option
    // When: the CLI runner handles it
    const result = runCli(['--help'])

    // Then: help is written to stdout with a successful exit code
    expect(result).toEqual({ exitCode: 0, stdout: GLOBAL_HELP, stderr: '' })
  })

  test.each([
    [['install', '--help'], INSTALL_HELP],
    [['doctor', '--help'], DOCTOR_HELP],
    [['login', '--help'], AUTH_HELP],
    [['logout', '--help'], AUTH_HELP],
    [['whoami', '--help'], AUTH_HELP],
    [['claude', '--help'], AGENT_HELP],
    [['codex', '--help'], AGENT_HELP],
    [['opencode', '--help'], AGENT_HELP],
  ])('prints deterministic command help for %j', (argv, expected) => {
    // Given: a command help invocation
    // When: the CLI runner handles it
    const result = runCli(argv)

    // Then: only the command contract is written to stdout
    expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: '' })
  })

  test('returns a concise nonzero result for an unknown command', () => {
    // Given: an unsupported command
    // When: the CLI runner handles it
    const result = runCli(['unknown'])

    // Then: the error has no stack trace or stdout noise
    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: "Unknown command 'unknown'.\nRun 'opencode-litellm --help' for usage.\n",
    })
    expect(result.stderr).not.toContain('at ')
  })
})
