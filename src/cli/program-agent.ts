import { join } from 'node:path'
import {
  AgentCommand,
  launchAgent,
} from './agent-launch'
import { BOUNDARY_COMMAND, type CliResult } from './command'
import {
  InstallAuth,
  type CodexMode,
} from './install-intent'
import {
  loadLaunchConfig,
  type LaunchClientState,
  type LaunchConfig,
} from './launch-config'
import { loadOfficialLiteLLMApiKey } from './official-token'
import {
  PathResolutionError,
  type PathEnv,
} from './paths'
import type { ProgramContext } from './program-contracts'
import { isHeaderSafeApiKey } from '../utils/api-key'
import { resolveProcessExitCode } from './process-exit-code'

const TOKEN_PATH = ['.litellm', 'token.json'] as const

export function runAgent(
  command: typeof BOUNDARY_COMMAND.Claude
    | typeof BOUNDARY_COMMAND.Codex
    | typeof BOUNDARY_COMMAND.OpenCode,
  argv: readonly string[],
  context: ProgramContext,
): CliResult {
  const launchConfig = loadLaunchConfig({ env: context.env })
  const state = resolveLaunchState(launchConfig, agentCommand(command))
  const apiKey = resolveLaunchApiKey(state, context.env)
  const result = launchAgent({
    command: agentCommand(command),
    args: argv,
    gatewayOrigin: state.gatewayOrigin,
    apiKey,
    authEnv: state.authEnv,
    configPath: state.configPath,
    codexMode: state.codexMode,
    environment: context.env,
  }, context.agentLaunchBoundary)
  return {
    exitCode: resolveProcessExitCode(result),
    stdout: '',
    stderr: '',
  }
}

function resolveLaunchApiKey(
  config: LaunchClientState,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  switch (config.auth) {
    case InstallAuth.Environment: {
      const key = environment[config.authEnv]
      if (isHeaderSafeApiKey(key)) return key
      throw new Error(
        `Environment variable '${config.authEnv}' is required by the installed LiteLLM launch configuration.`,
      )
    }
    case InstallAuth.Sso: {
      const key = loadOfficialLiteLLMApiKey({
        tokenFilePath: resolveTokenPath(environment),
        expectedBaseURL: config.gatewayOrigin,
      })
      if (key !== undefined) return key
      throw new Error(
        `No exact-origin LiteLLM SSO token is available for ${config.gatewayOrigin}; run 'opencode-litellm login --base-url ${config.gatewayOrigin}'.`,
      )
    }
    default:
      return assertNever(config.auth)
  }
}

type LaunchAgentState = LaunchClientState & {
  readonly configPath?: string
  readonly codexMode?: CodexMode
}

function resolveLaunchState(
  config: LaunchConfig,
  command: AgentCommand,
): LaunchAgentState {
  switch (command) {
    case AgentCommand.Claude:
      return config.claude
    case AgentCommand.Codex:
      if (config.codex === undefined) {
        throw new Error(
          "Codex launch is not configured; run 'codex-litellm install --target codex' first.",
        )
      }
      return config.codex
    case AgentCommand.OpenCode:
      if (config.openCode === undefined) {
        throw new Error(
          "OpenCode launch is not configured; run 'opencode-litellm install --target opencode' first.",
        )
      }
      return config.openCode
    default:
      return assertNever(command)
  }
}

function resolveTokenPath(env: PathEnv): string {
  const home = env.HOME
  if (home === undefined || home === '') {
    throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
  }
  return join(home, ...TOKEN_PATH)
}

function agentCommand(
  command: typeof BOUNDARY_COMMAND.Claude
    | typeof BOUNDARY_COMMAND.Codex
    | typeof BOUNDARY_COMMAND.OpenCode,
): AgentCommand {
  switch (command) {
    case BOUNDARY_COMMAND.Claude: return AgentCommand.Claude
    case BOUNDARY_COMMAND.Codex: return AgentCommand.Codex
    case BOUNDARY_COMMAND.OpenCode: return AgentCommand.OpenCode
    default: return assertNever(command)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected CLI value: ${String(value)}`)
}
