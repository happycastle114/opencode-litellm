import { BOUNDARY_COMMAND, CLIENT_COMMAND, CORE_COMMAND, type CliCommand } from './command-contracts'

export const GLOBAL_HELP = `Usage: opencode-litellm <command> [options]

Commands:
  install  Configure supported clients for LiteLLM
  doctor   Check the local LiteLLM integration
  login    Sign in through the official LiteLLM CLI (PKCE)
  logout   Log out through the official LiteLLM CLI
  whoami   Show safe local LiteLLM SSO session metadata
  claude   Launch Claude Code with OAuth-safe LiteLLM routing
  codex    Launch Codex with the installed LiteLLM configuration
  opencode Launch OpenCode with the installed LiteLLM toolkit

Options:
  --target <opencode|codex|both>  Client target
  --base-url <url>                LiteLLM gateway origin
  --auth <sso|env>                Gateway authentication
  --auth-env <name>               Gateway key environment variable
  --codex-mode <gateway|oauth|both|hybrid-server|hybrid-client> Codex connection mode
  --codex-fallback-model <model> Explicit paid gateway model for hybrid auto routing
  --auto-router <skip|configure|dry-run> Optional Claude Code Auto Router setup
  --search <name>                 Select an available search tool (repeatable)
  --mcp <name>                    Select an available MCP server (repeatable)
  --enable-mcp <name>             Enable a selected MCP server (repeatable)
  --disable-mcp <name>            Disable a selected MCP server (repeatable)
  --toolset <name>                Select an available MCP toolset (repeatable)
  --no-search                     Disable search tool registration
  --no-mcp                        Disable MCP server registration
  --no-toolsets                   Disable MCP toolset registration
  --non-interactive               Accept explicit values and discovery defaults
  -h, --help                      Show help
`

const INSTALL_HELP = `Usage: opencode-litellm install [options]

Configure supported clients for LiteLLM.

Options:
  --auto-router <skip|configure|dry-run> Optional Claude Code Auto Router setup
  --enable-mcp <name>  Enable a selected MCP server (repeatable)
  --disable-mcp <name> Disable a selected MCP server (repeatable)
  -h, --help           Show help
`

const DOCTOR_HELP = `Usage: opencode-litellm doctor [options]

Check the local LiteLLM integration.

Options:
  -h, --help  Show help
`

const AUTH_HELP = `Usage: opencode-litellm <login|logout|whoami> [options]

Manage SSO through the official LiteLLM CLI.
Requires lite on PATH: uv tool install 'litellm[cli]==1.101.0'

Options:
  --base-url <url>  LiteLLM gateway origin
  --auth-env <name> Legacy session variable to clear on logout
  -h, --help        Show help
`

const AGENT_HELP = `Usage: opencode-litellm <claude|codex|opencode> [args...]

Launch an agent with gateway credentials scoped to its child process.

Options:
  -h, --help  Show help; other arguments are forwarded to the agent
`

export function helpForCommand(command: CliCommand): string {
  switch (command) {
    case CLIENT_COMMAND.Install:
      return INSTALL_HELP
    case CORE_COMMAND.Doctor:
      return DOCTOR_HELP
    case BOUNDARY_COMMAND.Login:
    case BOUNDARY_COMMAND.Logout:
    case BOUNDARY_COMMAND.WhoAmI:
      return AUTH_HELP
    case BOUNDARY_COMMAND.Claude:
    case BOUNDARY_COMMAND.Codex:
    case BOUNDARY_COMMAND.OpenCode:
      return AGENT_HELP
    default:
      return assertNever(command)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
