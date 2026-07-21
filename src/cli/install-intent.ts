import {
  isValidToolName,
  isValidToolsetName,
} from '../utils/tool-name-validation'
import { AutoRouterMode, type AutoRouterMode as AutoRouterModeValue } from './auto-router-contracts'
export {
  TOOL_NAME_PATTERN,
  isValidToolName,
  isValidToolsetName,
} from '../utils/tool-name-validation'
export type {
  McpToolsetName,
  OpenCodeToolName,
} from '../utils/tool-name-validation'

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const GatewayPath = {
  V1: '/v1',
} as const

export const ReservedAuthEnvironment = {
  CodexHome: 'CODEX_HOME',
  OpenCodeConfig: 'OPENCODE_CONFIG',
  OpenCodeConfigDirectory: 'OPENCODE_CONFIG_DIR',
  OpenCodeEnableExa: 'OPENCODE_ENABLE_EXA',
  OpenAIApiKey: 'OPENAI_API_KEY',
  CodexApiKey: 'CODEX_API_KEY',
  AnthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  AnthropicApiKey: 'ANTHROPIC_API_KEY',
  AnthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  AnthropicCustomHeaders: 'ANTHROPIC_CUSTOM_HEADERS',
  OpenAIBaseUrl: 'OPENAI_BASE_URL',
  LiteLLMBaseUrl: 'LITELLM_BASE_URL',
  LiteLLMMasterKey: 'LITELLM_MASTER_KEY',
  LiteLLMProxyUrl: 'LITELLM_PROXY_URL',
  Home: 'HOME',
  XdgConfigHome: 'XDG_CONFIG_HOME',
  Path: 'PATH',
  NodeOptions: 'NODE_OPTIONS',
} as const

export type ReservedAuthEnvironment =
  (typeof ReservedAuthEnvironment)[keyof typeof ReservedAuthEnvironment]

const RESERVED_AUTH_ENVIRONMENTS: ReadonlySet<string> = new Set(
  Object.values(ReservedAuthEnvironment),
)

export function isValidEnvironmentName(value: string): boolean {
  return ENVIRONMENT_NAME_PATTERN.test(value) && !RESERVED_AUTH_ENVIRONMENTS.has(value)
}

export const McpServerId = {
  MinimaxSearch: 'minimax_search',
  Zread: 'zread',
  ZaiWebReader: 'zai_web_reader',
} as const

export type McpServerId = (typeof McpServerId)[keyof typeof McpServerId]

export const McpDefaultState = {
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const

export type McpDefaultState = (typeof McpDefaultState)[keyof typeof McpDefaultState]

export const McpServerDefaultStates: ReadonlyMap<string, McpDefaultState> = new Map([
  [McpServerId.MinimaxSearch, McpDefaultState.Disabled],
  [McpServerId.Zread, McpDefaultState.Enabled],
  [McpServerId.ZaiWebReader, McpDefaultState.Enabled],
])

export const InstallTarget = {
  OpenCode: 'opencode',
  Codex: 'codex',
  Both: 'both',
} as const

export type InstallTarget = (typeof InstallTarget)[keyof typeof InstallTarget]

export const InstallAuth = {
  Environment: 'env',
  Sso: 'sso',
} as const

export type InstallAuth = (typeof InstallAuth)[keyof typeof InstallAuth]

export const CodexMode = {
  Gateway: 'gateway',
  OAuth: 'oauth',
  Both: 'both',
} as const

export type CodexMode = (typeof CodexMode)[keyof typeof CodexMode]

export const ToolkitDefault = {
  GatewayOrigin: 'https://llm.soungmin.kr',
  Auth: InstallAuth.Sso,
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  Target: InstallTarget.OpenCode,
  CodexMode: CodexMode.Both,
  InteractiveAutoRouter: AutoRouterMode.Prompt,
  NonInteractiveAutoRouter: AutoRouterMode.Skip,
} as const

export type InstallOptions = {
  readonly target: InstallTarget
  readonly baseUrl: string | undefined
  readonly auth: InstallAuth
  readonly authEnv: string | undefined
  readonly nonInteractive: boolean
  readonly opencodeConfig: string | undefined
  readonly codexConfig: string | undefined
  readonly codexMode: CodexMode
  readonly autoRouter: AutoRouterModeValue
  readonly search: readonly string[]
  readonly mcp: readonly string[]
  readonly toolsets: readonly string[]
  readonly enableMcp: readonly string[]
  readonly disableMcp: readonly string[]
  readonly noSearch: boolean
  readonly noMcp: boolean
  readonly noToolsets: boolean
}

export type OpenCodeInstallIntent = {
  readonly baseUrl: string
  readonly authEnv: string
  readonly search: readonly string[]
  readonly mcp: readonly string[]
  readonly toolsets: readonly string[]
  readonly enableMcp: readonly string[]
  readonly disableMcp: readonly string[]
  readonly opencodeConfig: string | undefined
}

export type CodexInstallIntent = {
  readonly baseUrl: string
  readonly authEnv: string
  readonly mode: CodexMode
}

export type InstallIntent = {
  readonly opencode: OpenCodeInstallIntent | undefined
  readonly codex: CodexInstallIntent | undefined
}

export type InstallIntentResult =
  | { readonly ok: true; readonly intent: InstallIntent }
  | { readonly ok: false; readonly message: string }

export function resolveInstallIntent(options: InstallOptions): InstallIntentResult {
  const wantsOpenCode =
    options.target === InstallTarget.OpenCode || options.target === InstallTarget.Both
  const wantsCodex =
    options.target === InstallTarget.Codex || options.target === InstallTarget.Both

  const missing = collectMissing(options)
  if (missing.length > 0) {
    return fail(`Missing required options: ${missing.join(', ')}.`)
  }

  if (options.authEnv !== undefined && !isValidEnvironmentName(options.authEnv)) {
    return fail("'--auth-env' must be a valid environment variable name.")
  }

  const stateOverrideError = mcpStateOverrideConflict(options.enableMcp, options.disableMcp)
  if (stateOverrideError !== undefined) return fail(stateOverrideError)

  const baseUrl = normalizeOrigin(options.baseUrl ?? '')
  if (baseUrl === undefined) {
    return fail(
      "'--base-url' must be an absolute http(s) origin without credentials, query, or fragment.",
    )
  }

  const names = validateNames([
    ...options.search,
    ...options.mcp,
    ...options.enableMcp,
    ...options.disableMcp,
  ])
  if (names !== undefined) return fail(names)
  const toolsets = validateToolsetNames(options.toolsets)
  if (toolsets !== undefined) return fail(toolsets)

  return {
    ok: true,
    intent: {
      opencode: wantsOpenCode
        ? {
            baseUrl,
            authEnv: options.authEnv ?? '',
            search: options.noSearch ? [] : options.search,
            mcp: options.noMcp ? [] : options.mcp,
            toolsets: options.noToolsets ? [] : options.toolsets,
            enableMcp: options.noMcp ? [] : options.enableMcp,
            disableMcp: options.noMcp ? [] : options.disableMcp,
            opencodeConfig: options.opencodeConfig,
          }
        : undefined,
      codex: wantsCodex
        ? { baseUrl, authEnv: options.authEnv ?? '', mode: options.codexMode }
        : undefined,
    },
  }
}

export function mcpStateOverrideConflict(
  enabledNames: readonly string[],
  disabledNames: readonly string[],
): string | undefined {
  const disabled = new Set(disabledNames)
  for (const name of enabledNames) {
    if (disabled.has(name)) {
      return `MCP server '${name}' cannot be both enabled and disabled.`
    }
  }
  return undefined
}

export function normalizeOrigin(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (url.search !== '' || url.hash !== '') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  const gatewayPath = path.endsWith(GatewayPath.V1)
    ? path.slice(0, -GatewayPath.V1.length).replace(/\/+$/, '')
    : path
  return `${url.protocol}//${url.host}${gatewayPath}`
}

function collectMissing(options: InstallOptions): readonly string[] {
  if (!options.nonInteractive) return []
  const missing: string[] = []
  if (options.baseUrl === undefined) missing.push('--base-url')
  if (options.authEnv === undefined) missing.push('--auth-env')
  return missing
}

function validateNames(names: readonly string[]): string | undefined {
  for (const name of names) {
    if (!isValidToolName(name)) {
      return `Invalid tool or server name '${name}'; use lowercase letters, numbers, underscores, or hyphens.`
    }
  }
  return undefined
}

function validateToolsetNames(names: readonly string[]): string | undefined {
  for (const name of names) {
    if (!isValidToolsetName(name)) {
      return `Invalid MCP toolset name '${name}'; use a non-empty printable name without '/'.`
    }
  }
  return undefined
}

function fail(message: string): InstallIntentResult {
  return { ok: false, message }
}
