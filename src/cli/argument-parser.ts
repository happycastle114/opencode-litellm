import {
  InstallAuth,
  CodexMode,
  InstallTarget,
  ToolkitDefault,
  type InstallOptions,
} from './install-intent'

export type DoctorOptions = {
  readonly target: InstallTarget
  readonly json: boolean
  readonly opencodeConfig: string | undefined
  readonly codexConfig: string | undefined
}

export type OptionParseResult<T> =
  | { readonly ok: true; readonly options: T }
  | { readonly ok: false; readonly message: string }

export function parseInstallOptions(argv: readonly string[]): OptionParseResult<InstallOptions> {
  const values = new Map<string, string>()
  const search: string[] = []
  const mcp: string[] = []
  const disableMcp: string[] = []
  const toolsets: string[] = []
  let nonInteractive = false
  let noSearch = false
  let noMcp = false
  let noToolsets = false

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === undefined) continue
    if (option === '--non-interactive') nonInteractive = true
    else if (option === '--no-search') noSearch = true
    else if (option === '--no-mcp') noMcp = true
    else if (option === '--no-toolsets') noToolsets = true
    else {
      const value = argv[index + 1]
      if (!VALUE_OPTIONS.has(option)) return fail(`Unknown option '${option}' for command 'install'.`)
      if (value === undefined || value.startsWith('--')) return fail(`Option '${option}' requires a value.`)
      if (option === '--search') search.push(value)
      else if (option === '--mcp') mcp.push(value)
      else if (option === '--toolset') toolsets.push(value)
      else if (option === '--disable-mcp') disableMcp.push(value)
      else values.set(option, value)
      index += 1
    }
  }

  const target = readTarget(values.get('--target') ?? ToolkitDefault.Target, '--target')
  if (!target.ok) return target
  const auth = readAuth(values.get('--auth') ?? ToolkitDefault.Auth)
  if (!auth.ok) return auth
  const codexMode = readCodexMode(values.get('--codex-mode') ?? ToolkitDefault.CodexMode)
  if (!codexMode.ok) return codexMode
  return {
    ok: true,
    options: {
      target: target.value,
      baseUrl: values.get('--base-url') ?? ToolkitDefault.GatewayOrigin,
      auth: auth.value,
      authEnv: values.get('--auth-env') ?? ToolkitDefault.AuthEnvironment,
      nonInteractive,
      opencodeConfig: values.get('--opencode-config'),
      codexConfig: values.get('--codex-config'),
      codexMode: codexMode.value,
      search,
      mcp,
      toolsets,
      disableMcp,
      noSearch,
      noMcp,
      noToolsets,
    },
  }
}

export function parseDoctorOptions(argv: readonly string[]): OptionParseResult<DoctorOptions> {
  const values = new Map<string, string>()
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === undefined) continue
    if (option === '--json') json = true
    else {
      const value = argv[index + 1]
      if (!DOCTOR_VALUE_OPTIONS.has(option)) return fail(`Unknown option '${option}' for command 'doctor'.`)
      if (value === undefined || value.startsWith('--')) return fail(`Option '${option}' requires a value.`)
      values.set(option, value)
      index += 1
    }
  }
  const target = readTarget(values.get('--target') ?? InstallTarget.Both, '--target')
  if (!target.ok) return target
  return {
    ok: true,
    options: {
      target: target.value,
      json,
      opencodeConfig: values.get('--opencode-config'),
      codexConfig: values.get('--codex-config'),
    },
  }
}

const VALUE_OPTIONS = new Set([
  '--target', '--base-url', '--auth', '--auth-env', '--opencode-config', '--codex-config',
  '--codex-mode', '--search', '--mcp', '--toolset', '--disable-mcp',
])
const DOCTOR_VALUE_OPTIONS = new Set(['--target', '--opencode-config', '--codex-config'])

type ValueResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

function readTarget(value: string, option: string): ValueResult<InstallTarget> {
  if (Object.values(InstallTarget).some((target) => target === value)) {
    return { ok: true, value: value as InstallTarget }
  }
  return fail(`Invalid value '${value}' for '${option}'.`)
}

function readAuth(value: string): ValueResult<InstallAuth> {
  if (Object.values(InstallAuth).some((auth) => auth === value)) {
    return { ok: true, value: value as InstallAuth }
  }
  return fail(`Invalid value '${value}' for '--auth'.`)
}

function readCodexMode(value: string): ValueResult<CodexMode> {
  if (Object.values(CodexMode).some((mode) => mode === value)) {
    return { ok: true, value: value as CodexMode }
  }
  return fail(`Invalid value '${value}' for '--codex-mode'.`)
}

function fail(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message }
}
