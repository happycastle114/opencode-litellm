import { CodexMode, InstallAuth, InstallTarget, normalizeOrigin } from './install-intent'
import type {
  CodexMode as CodexModeValue,
  InstallAuth as InstallAuthValue,
  InstallTarget as InstallTargetValue,
} from './install-intent'

export const CodexOnboardingMode = CodexMode
export type CodexOnboardingMode = CodexModeValue

export const OnboardingResourceAccess = { Authorized: 'authorized', Unavailable: 'unavailable' } as const
export type OnboardingResourceAccess = (typeof OnboardingResourceAccess)[keyof typeof OnboardingResourceAccess]
export type OnboardingResource = { readonly name: string; readonly access: OnboardingResourceAccess }

export type OnboardingInput = {
  readonly defaultTarget: InstallTargetValue; readonly defaultGatewayOrigin: string
  readonly defaultAuth: InstallAuthValue; readonly defaultCodexMode: CodexOnboardingMode
  readonly searchTools: readonly OnboardingResource[]
  readonly mcpServers: readonly OnboardingResource[]; readonly mcpToolsets: readonly OnboardingResource[]
  readonly loadResources?: OnboardingResourceLoader
}

export interface OnboardingIO {
  readonly isTTY: boolean; readonly prompt: (message: string) => Promise<string>
  readonly write: (message: string) => void
}

type CommonOnboardingPlan = {
  readonly gatewayOrigin: string; readonly auth: InstallAuthValue
  readonly searchTools: readonly string[]; readonly mcpServers: readonly string[]
  readonly mcpToolsets: readonly string[]
}

export type OnboardingPlan =
  | (CommonOnboardingPlan & { readonly target: typeof InstallTarget.OpenCode })
  | (CommonOnboardingPlan & {
      readonly target: typeof InstallTarget.Codex | typeof InstallTarget.Both
      readonly codexMode: CodexOnboardingMode
    })

export const OnboardingFailureCode = { TtyRequired: 'tty-required', Cancelled: 'cancelled' } as const
export type OnboardingFailureCode = (typeof OnboardingFailureCode)[keyof typeof OnboardingFailureCode]

export type OnboardingResult =
  | { readonly ok: true; readonly plan: OnboardingPlan }
  | {
      readonly ok: false
      readonly failure: { readonly code: OnboardingFailureCode; readonly message: string }
    }

type NumberedChoice<Value extends string> = { readonly label: string; readonly value: Value }

type SingleSelectionRequest<Value extends string> = {
  readonly io: OnboardingIO; readonly title: string; readonly prompt: string
  readonly choices: readonly NumberedChoice<Value>[]; readonly defaultValue: Value
}

type ResourceSelectionRequest = {
  readonly io: OnboardingIO; readonly title: string
  readonly resources: readonly OnboardingResource[]
}

type OnboardingShape =
  | { readonly target: typeof InstallTarget.OpenCode }
  | {
      readonly target: typeof InstallTarget.Codex | typeof InstallTarget.Both
      readonly codexMode: CodexOnboardingMode
    }

export type OnboardingConnection = OnboardingShape & {
  readonly gatewayOrigin: string
  readonly auth: InstallAuthValue
}

export type OnboardingResources = Pick<
  OnboardingInput,
  'searchTools' | 'mcpServers' | 'mcpToolsets'
>

export type OnboardingResourceLoader = (
  connection: OnboardingConnection,
) => Promise<OnboardingResources>

const InputToken = {
  Default: '', None: '0', Yes: 'y', YesLong: 'yes', No: 'n', NoLong: 'no',
} as const

const UiText = {
  TargetTitle: 'Install target',
  TargetPrompt: 'Choose a target number',
  GatewayPrompt: 'LiteLLM gateway origin',
  AuthTitle: 'Gateway authentication',
  AuthPrompt: 'Choose an authentication number',
  CodexTitle: 'Codex connection mode',
  CodexPrompt: 'Choose a Codex mode number',
  SearchTitle: 'Search tools',
  McpTitle: 'MCP servers',
  ToolsetTitle: 'MCP toolsets',
  MultiPrompt: 'Choose comma-separated numbers, 0 for none, or Enter for all',
  ConfirmPrompt: 'Apply this plan? [y/N]',
  DefaultMarker: ' (default)',
  InvalidNumber: 'Enter one of the listed numbers.',
  InvalidOrigin: 'Enter an absolute http(s) origin without credentials, query, or fragment.',
  InvalidMulti: 'Enter unique listed numbers separated by commas, 0, or Enter.',
  InvalidConfirmation: 'Enter y or n.',
  Cancelled: 'Installation cancelled.',
  TtyRequired:
    'Interactive onboarding requires a TTY. Re-run with --non-interactive and explicit install options.',
} as const

const TARGET_CHOICES: readonly NumberedChoice<InstallTargetValue>[] = [
  { label: 'OpenCode', value: InstallTarget.OpenCode }, { label: 'Codex', value: InstallTarget.Codex },
  { label: 'Both', value: InstallTarget.Both },
]

const AUTH_CHOICES: readonly NumberedChoice<InstallAuthValue>[] = [
  { label: 'LiteLLM SSO', value: InstallAuth.Sso }, { label: 'Environment variable', value: InstallAuth.Environment },
]

const CODEX_CHOICES: readonly NumberedChoice<CodexOnboardingMode>[] = [
  { label: 'LiteLLM gateway', value: CodexMode.Gateway }, { label: 'Codex OAuth pass-through', value: CodexMode.OAuth },
  { label: 'Both profiles', value: CodexMode.Both },
]

const DECIMAL_PATTERN = /^[1-9]\d*$/

const CONFIRMATION_VALUES: ReadonlyMap<string, boolean> = new Map([
  [InputToken.Yes, true],
  [InputToken.YesLong, true],
  [InputToken.No, false],
  [InputToken.NoLong, false],
  [InputToken.Default, false],
])

export async function runInstallOnboarding(
  input: OnboardingInput,
  io: OnboardingIO,
): Promise<OnboardingResult> {
  if (!io.isTTY) {
    return failure(OnboardingFailureCode.TtyRequired, UiText.TtyRequired)
  }

  const target = await selectSingle({
    io, title: UiText.TargetTitle, prompt: UiText.TargetPrompt, choices: TARGET_CHOICES,
    defaultValue: input.defaultTarget,
  })
  const gatewayOrigin = await selectGatewayOrigin(input.defaultGatewayOrigin, io)
  const auth = await selectSingle({
    io, title: UiText.AuthTitle, prompt: UiText.AuthPrompt, choices: AUTH_CHOICES,
    defaultValue: input.defaultAuth,
  })
  const shape = await selectShape(target, input.defaultCodexMode, io)
  const connection = { ...shape, gatewayOrigin, auth }
  const resources = input.loadResources === undefined
    ? input
    : await input.loadResources(connection)
  const searchTools = await selectResources({
    io, title: UiText.SearchTitle, resources: resources.searchTools,
  })
  const mcpServers = await selectResources({ io, title: UiText.McpTitle, resources: resources.mcpServers })
  const mcpToolsets = await selectResources({ io, title: UiText.ToolsetTitle, resources: resources.mcpToolsets })
  const plan: OnboardingPlan = {
    ...shape,
    gatewayOrigin,
    auth,
    searchTools,
    mcpServers,
    mcpToolsets,
  }

  io.write(JSON.stringify(plan, undefined, 2))
  if (!(await confirm(io))) {
    return failure(OnboardingFailureCode.Cancelled, UiText.Cancelled)
  }
  return { ok: true, plan }
}

async function selectSingle<Value extends string>(
  request: SingleSelectionRequest<Value>,
): Promise<Value> {
  const lines = request.choices.map(
    (choice, index) => `${index + 1}. ${choice.label}${choice.value === request.defaultValue ? UiText.DefaultMarker : InputToken.Default}`,
  )
  request.io.write([request.title, ...lines].join('\n'))
  while (true) {
    const raw = (await request.io.prompt(request.prompt)).trim()
    if (raw === InputToken.Default) return request.defaultValue
    const index = parseChoiceNumber(raw, request.choices.length)
    const choice = index === undefined ? undefined : request.choices[index - 1]
    if (choice !== undefined) return choice.value
    request.io.write(UiText.InvalidNumber)
  }
}

async function selectGatewayOrigin(defaultOrigin: string, io: OnboardingIO): Promise<string> {
  while (true) {
    const raw = (await io.prompt(`${UiText.GatewayPrompt} [${defaultOrigin}]`)).trim()
    const origin = normalizeOrigin(raw === InputToken.Default ? defaultOrigin : raw)
    if (origin !== undefined) return origin
    io.write(UiText.InvalidOrigin)
  }
}

async function selectShape(target: InstallTargetValue, defaultCodexMode: CodexOnboardingMode, io: OnboardingIO): Promise<OnboardingShape> {
  switch (target) {
    case InstallTarget.OpenCode:
      return { target }
    case InstallTarget.Codex:
    case InstallTarget.Both:
      return {
        target,
        codexMode: await selectSingle({
          io, title: UiText.CodexTitle, prompt: UiText.CodexPrompt, choices: CODEX_CHOICES,
          defaultValue: defaultCodexMode,
        }),
      }
    default:
      return assertNever(target)
  }
}

async function selectResources(request: ResourceSelectionRequest): Promise<readonly string[]> {
  const authorized = request.resources.filter((resource) => resource.access === OnboardingResourceAccess.Authorized)
  if (authorized.length === 0) return []

  const lines = authorized.map((resource, index) => `${index + 1}. ${resource.name}`)
  request.io.write([request.title, ...lines].join('\n'))
  while (true) {
    const raw = (await request.io.prompt(UiText.MultiPrompt)).trim()
    if (raw === InputToken.Default) return authorized.map((resource) => resource.name)
    if (raw === InputToken.None) return []
    const indexes = parseMultipleChoiceNumbers(raw, authorized.length)
    if (indexes !== undefined) {
      const selected = new Set(indexes)
      return authorized
        .filter((_resource, index) => selected.has(index + 1))
        .map((resource) => resource.name)
    }
    request.io.write(UiText.InvalidMulti)
  }
}

function parseChoiceNumber(raw: string, choiceCount: number): number | undefined {
  if (!DECIMAL_PATTERN.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= choiceCount ? value : undefined
}

function parseMultipleChoiceNumbers(raw: string, choiceCount: number): readonly number[] | undefined {
  const tokens = raw.split(',').map((token) => token.trim())
  const selected = new Set<number>()
  for (const token of tokens) {
    const value = parseChoiceNumber(token, choiceCount)
    if (value === undefined || selected.has(value)) return undefined
    selected.add(value)
  }
  return [...selected]
}

async function confirm(io: OnboardingIO): Promise<boolean> {
  while (true) {
    const raw = (await io.prompt(UiText.ConfirmPrompt)).trim().toLowerCase()
    const confirmed = CONFIRMATION_VALUES.get(raw)
    if (confirmed !== undefined) return confirmed
    io.write(UiText.InvalidConfirmation)
  }
}

function failure(code: OnboardingFailureCode, message: string): OnboardingResult {
  return { ok: false, failure: { code, message } }
}

function assertNever(value: never): never {
  throw new OnboardingInvariantError(value)
}

class OnboardingInvariantError extends Error {
  readonly value: never

  constructor(value: never) {
    super('Unhandled onboarding variant.')
    this.name = 'OnboardingInvariantError'
    this.value = value
  }
}
