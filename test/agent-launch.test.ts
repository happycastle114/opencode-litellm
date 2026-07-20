import { describe, expect, test } from 'bun:test'

const CodexMode = {
  Gateway: 'gateway',
  OAuth: 'oauth',
  Both: 'both',
} as const

type CodexMode = (typeof CodexMode)[keyof typeof CodexMode]
type AgentLaunchInput = {
  readonly command: string
  readonly args: readonly string[]
  readonly gatewayOrigin: string
  readonly apiKey?: string
  readonly codexMode?: CodexMode
  readonly environment?: Readonly<Record<string, string | undefined>>
}
type AgentProcessResult = { readonly status: number | null; readonly signal: string | null }
type AgentSpawnOptions = {
  readonly stdio: 'inherit'
  readonly env: Readonly<Record<string, string | undefined>>
}
type AgentLaunchBoundary = {
  readonly which?: (command: string) => string | undefined
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: AgentSpawnOptions,
  ) => AgentProcessResult
}
type LaunchAgent = (
  input: AgentLaunchInput,
  boundary?: AgentLaunchBoundary,
) => AgentProcessResult

async function loadLauncher(): Promise<unknown> {
  try {
    return await import('../src/cli/agent-launch')
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLauncher(module: unknown): LaunchAgent | undefined {
  if (!isRecord(module)) return undefined
  const candidate = module.launchAgent
  return typeof candidate === 'function' ? candidate as LaunchAgent : undefined
}

function boundaryFor(
  calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }>,
  result: AgentProcessResult = { status: 0, signal: null },
): AgentLaunchBoundary {
  return {
    which: (command) => command,
    spawn: (file, args, options) => {
      calls.push({ file, args, options })
      return result
    },
  }
}

describe('direct LiteLLM agent launcher', () => {
  test('routes Claude Code through /claude-max without replacing Anthropic OAuth', async () => {
    // Given: a Claude environment with conflicting API credentials and a gateway key
    const launchAgent = readLauncher(await loadLauncher())
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }> = []
    const environment = {
      HOME: '/tmp/home',
      ANTHROPIC_API_KEY: 'ambient-api-key',
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Trace: one',
      LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
    } as const

    // When: Claude is launched with a gateway admission key
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return
    launchAgent({
      command: 'claude',
      args: ['--model', 'claude-sonnet'],
      gatewayOrigin: 'https://llm.example.com/',
      apiKey: 'child-gateway-key',
      environment,
    }, boundaryFor(calls))

    // Then: only the child receives the routed endpoint and separate admission header
    const call = calls[0]
    expect(call?.file).toBe('claude')
    expect(call?.args).toEqual(['--model', 'claude-sonnet'])
    expect(call?.options.stdio).toBe('inherit')
    expect(call?.options.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://llm.example.com/claude-max',
      ANTHROPIC_CUSTOM_HEADERS: 'x-litellm-api-key: Bearer child-gateway-key',
    })
    expect(call?.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(call?.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(environment.ANTHROPIC_API_KEY).toBe('ambient-api-key')
    expect(JSON.stringify(call?.options)).not.toContain('ambient-api-key')
  })

  test('injects the Codex OAuth profile only when the caller did not choose one', async () => {
    // Given: a Codex OAuth launch with no explicit profile
    const launchAgent = readLauncher(await loadLauncher())
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }> = []
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return

    // When: Codex is launched in OAuth mode
    launchAgent({
      command: 'codex',
      args: ['resume', '--last'],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-gateway-key',
      codexMode: CodexMode.OAuth,
      environment: {
        CODEX_API_KEY: 'ambient-codex-key',
        OPENAI_API_KEY: 'ambient-openai-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      },
    }, boundaryFor(calls))

    // Then: the configured OAuth profile is selected and only the gateway key is added
    expect(calls[0]?.args).toEqual(['--profile', 'codex-oauth', 'resume', '--last'])
    expect(calls[0]?.options.env.LITELLM_PROXY_API_KEY).toBe('child-gateway-key')
    expect(calls[0]?.options.env.CODEX_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENAI_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENAI_BASE_URL).toBeUndefined()
    expect(JSON.stringify(calls[0]?.args)).not.toContain('child-gateway-key')
  })

  test('preserves an explicit Codex profile and forwards status and signal', async () => {
    // Given: a caller-selected Codex profile and a child terminated by SIGINT
    const launchAgent = readLauncher(await loadLauncher())
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }> = []
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return

    // When: the OAuth-mode launch is handed to the process boundary
    const result = launchAgent({
      command: 'codex',
      args: ['--profile', 'custom', 'resume'],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'child-gateway-key',
      codexMode: CodexMode.OAuth,
      environment: {},
    }, boundaryFor(calls, { status: null, signal: 'SIGINT' }))

    // Then: user args and the child termination result are preserved
    expect(calls[0]?.args).toEqual(['--profile', 'custom', 'resume'])
    expect(result).toEqual({ status: null, signal: 'SIGINT' })
  })

  test('launches OpenCode with managed token context but no gateway secret environment', async () => {
    // Given: an OpenCode process inheriting stale secret variables
    const launchAgent = readLauncher(await loadLauncher())
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }> = []
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return

    // When: OpenCode is launched through the managed plugin/token path
    launchAgent({
      command: 'opencode',
      args: ['--help'],
      gatewayOrigin: 'https://llm.example.com/',
      apiKey: 'must-not-be-forwarded',
      environment: {
        LITELLM_PROXY_API_KEY: 'ambient-gateway-key',
        OPENCODE_LITELLM_API_KEY: 'ambient-opencode-key',
      },
    }, boundaryFor(calls))

    // Then: gateway context is child-scoped and the managed token remains authoritative
    expect(calls[0]?.file).toBe('opencode')
    expect(calls[0]?.args).toEqual(['--help'])
    expect(calls[0]?.options.env.LITELLM_PROXY_URL).toBe('https://llm.example.com')
    expect(calls[0]?.options.env.LITELLM_PROXY_API_KEY).toBeUndefined()
    expect(calls[0]?.options.env.OPENCODE_LITELLM_API_KEY).toBeUndefined()
    expect(JSON.stringify(calls[0]?.options)).not.toContain('must-not-be-forwarded')
  })

  test('rejects unsupported commands before spawning', async () => {
    // Given: a command outside the owned launcher set
    const launchAgent = readLauncher(await loadLauncher())
    const calls: Array<{ readonly file: string; readonly args: readonly string[]; readonly options: AgentSpawnOptions }> = []
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return

    // When / Then: validation fails deterministically and the child boundary is untouched
    expect(() => launchAgent({
      command: 'login',
      args: [],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'secret',
      environment: {},
    }, boundaryFor(calls))).toThrow(/unsupported.*command/i)
    expect(calls).toHaveLength(0)
  })

  test('reports a deterministic executable-not-found error', async () => {
    // Given: a validated command whose executable cannot be resolved
    const launchAgent = readLauncher(await loadLauncher())
    let spawnCalled = false
    expect(launchAgent).toBeFunction()
    if (launchAgent === undefined) return

    // When / Then: lookup fails without printing or persisting the key
    expect(() => launchAgent({
      command: 'claude',
      args: [],
      gatewayOrigin: 'https://llm.example.com',
      apiKey: 'secret-key',
      environment: {},
    }, {
      which: () => undefined,
      spawn: () => {
        spawnCalled = true
        return { status: 0, signal: null }
      },
    })).toThrow(/claude.*not found.*path/i)
    expect(spawnCalled).toBe(false)
  })
})
