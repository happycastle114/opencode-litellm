import { basename, dirname } from 'node:path'
import {
  AgentCommand,
  AgentLaunchError,
  type AgentLaunchInput,
} from './agent-launch-contracts'
import { isValidEnvironmentName } from './install-intent'
import { isHeaderSafeApiKey } from '../utils/api-key'

const EnvironmentName = {
  AnthropicApiKey: 'ANTHROPIC_API_KEY',
  AnthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  AnthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  AnthropicCustomHeaders: 'ANTHROPIC_CUSTOM_HEADERS',
  CodexApiKey: 'CODEX_API_KEY',
  GatewayApiKey: 'LITELLM_PROXY_API_KEY',
  GatewayUrl: 'LITELLM_PROXY_URL',
  LiteLLMApiKey: 'LITELLM_API_KEY',
  LiteLLMMasterKey: 'LITELLM_MASTER_KEY',
  OpenAiApiKey: 'OPENAI_API_KEY',
  OpenAiBaseUrl: 'OPENAI_BASE_URL',
  OpenCodeApiKey: 'OPENCODE_LITELLM_API_KEY',
  OpenCodeConfig: 'OPENCODE_CONFIG',
  OpenCodeConfigDirectory: 'OPENCODE_CONFIG_DIR',
  OpenCodeEnableExa: 'OPENCODE_ENABLE_EXA',
} as const

const ClaudeMaxPath = '/claude-max'
const CodexConfigFileName = 'config.toml'
const ProxyAdmissionHeader = 'x-litellm-api-key'
const COMMON_LITELLM_SECRET_NAMES = [
  EnvironmentName.GatewayApiKey,
  EnvironmentName.LiteLLMApiKey,
  EnvironmentName.LiteLLMMasterKey,
  EnvironmentName.OpenCodeApiKey,
] as const

const CLAUDE_SECRET_ENVIRONMENT_NAMES = [
  EnvironmentName.AnthropicApiKey,
  EnvironmentName.AnthropicAuthToken,
  EnvironmentName.AnthropicBaseUrl,
  EnvironmentName.AnthropicCustomHeaders,
] as const

const CODEX_SECRET_ENVIRONMENT_NAMES = [
  EnvironmentName.CodexApiKey,
  EnvironmentName.OpenAiApiKey,
  EnvironmentName.OpenAiBaseUrl,
] as const

const OPENCODE_SECRET_ENVIRONMENT_NAMES = [
  EnvironmentName.GatewayUrl,
  EnvironmentName.OpenCodeEnableExa,
] as const

const OPENCODE_CONFIG_ENVIRONMENT_NAMES = [
  EnvironmentName.OpenCodeConfig,
  EnvironmentName.OpenCodeConfigDirectory,
] as const

export function buildChildEnvironment(
  command: AgentCommand,
  input: AgentLaunchInput,
  origin: string,
): Readonly<Record<string, string | undefined>> {
  const environment: Record<string, string | undefined> = {
    ...(input.environment ?? process.env),
  }
  const authEnvironment = resolveAuthEnvironment(input.authEnv)
  deleteEnvironmentNames(environment, COMMON_LITELLM_SECRET_NAMES)
  delete environment[authEnvironment]

  switch (command) {
    case AgentCommand.Claude:
      return buildClaudeEnvironment(environment, origin, input.apiKey, authEnvironment)
    case AgentCommand.Codex:
      return buildCodexEnvironment(environment, input.apiKey, authEnvironment, input.configPath)
    case AgentCommand.OpenCode:
      return buildOpenCodeEnvironment(
        environment,
        origin,
        input.apiKey,
        authEnvironment,
        input.configPath,
      )
    default:
      return assertNever(command)
  }
}

function buildClaudeEnvironment(
  environment: Record<string, string | undefined>,
  origin: string,
  apiKey: string | undefined,
  authEnv: string,
): Readonly<Record<string, string | undefined>> {
  const key = requireApiKey(AgentCommand.Claude, apiKey)
  deleteEnvironmentNames(environment, CLAUDE_SECRET_ENVIRONMENT_NAMES)
  delete environment[resolveAuthEnvironment(authEnv)]
  environment[EnvironmentName.AnthropicBaseUrl] = `${origin}${ClaudeMaxPath}`
  environment[EnvironmentName.AnthropicCustomHeaders] =
    `${ProxyAdmissionHeader}: Bearer ${key}`
  return environment
}

function buildCodexEnvironment(
  environment: Record<string, string | undefined>,
  apiKey: string | undefined,
  authEnv: string,
  configPath: string | undefined,
): Readonly<Record<string, string | undefined>> {
  if (configPath !== undefined && basename(configPath) !== CodexConfigFileName) {
    throw new AgentLaunchError(
      `The configured Codex path '${configPath}' must end in '${CodexConfigFileName}'; reinstall with --codex-config pointing to ${CodexConfigFileName}.`,
    )
  }
  const key = requireApiKey(AgentCommand.Codex, apiKey)
  deleteEnvironmentNames(environment, CODEX_SECRET_ENVIRONMENT_NAMES)
  const targetEnvironment = resolveAuthEnvironment(authEnv)
  delete environment[targetEnvironment]
  environment[targetEnvironment] = key
  if (configPath !== undefined) {
    environment.CODEX_HOME = dirname(configPath)
  }
  return environment
}

function buildOpenCodeEnvironment(
  environment: Record<string, string | undefined>,
  origin: string,
  apiKey: string | undefined,
  authEnv: string,
  configPath: string | undefined,
): Readonly<Record<string, string | undefined>> {
  const key = requireApiKey(AgentCommand.OpenCode, apiKey)
  deleteEnvironmentNames(environment, OPENCODE_SECRET_ENVIRONMENT_NAMES)
  deleteEnvironmentNames(environment, OPENCODE_CONFIG_ENVIRONMENT_NAMES)
  delete environment[authEnv]
  environment[EnvironmentName.GatewayUrl] = origin
  environment[authEnv] = key
  environment[EnvironmentName.OpenCodeApiKey] = key
  if (configPath !== undefined) {
    environment[EnvironmentName.OpenCodeConfig] = configPath
    environment[EnvironmentName.OpenCodeConfigDirectory] = dirname(configPath)
  }
  return environment
}

function resolveAuthEnvironment(value: string | undefined): string {
  const name = value ?? EnvironmentName.GatewayApiKey
  if (!isValidEnvironmentName(name)) {
    throw new AgentLaunchError('The configured LiteLLM auth environment name is invalid.')
  }
  return name
}

function deleteEnvironmentNames(
  environment: Record<string, string | undefined>,
  names: readonly string[],
): void {
  for (const name of names) delete environment[name]
}

function requireApiKey(command: AgentCommand, value: string | undefined): string {
  if (!isHeaderSafeApiKey(value)) {
    throw new AgentLaunchError(`A LiteLLM API key is required to launch '${command}'.`)
  }
  return value
}

function assertNever(value: never): never {
  throw new AgentLaunchError(`Unexpected agent command '${String(value)}'.`)
}
