const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

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
  readonly search: readonly string[]
  readonly mcp: readonly string[]
  readonly toolsets: readonly string[]
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

  const baseUrl = normalizeOrigin(options.baseUrl ?? '')
  if (baseUrl === undefined) {
    return fail(
      "'--base-url' must be an absolute http(s) origin without credentials, query, or fragment.",
    )
  }

  const names = validateNames([...options.search, ...options.mcp, ...options.disableMcp])
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
  return `${url.protocol}//${url.host}${path}`
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
    if (!TOOL_NAME_PATTERN.test(name)) {
      return `Invalid tool or server name '${name}'; use lowercase letters, numbers, underscores, or hyphens.`
    }
  }
  return undefined
}

function validateToolsetNames(names: readonly string[]): string | undefined {
  for (const name of names) {
    if (name.trim() === '' || /[\u0000-\u001f\u007f]/.test(name)) {
      return `Invalid MCP toolset name '${name}'; use a non-empty printable name.`
    }
  }
  return undefined
}

function fail(message: string): InstallIntentResult {
  return { ok: false, message }
}
