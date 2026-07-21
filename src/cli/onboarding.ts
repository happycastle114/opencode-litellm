import { CodexMode, InstallAuth, InstallTarget, normalizeOrigin } from './install-intent'
import {
  AutoRouterMode,
  type AutoRouterMode as AutoRouterModeValue,
} from './auto-router-contracts'
import type {
  CodexMode as CodexModeValue,
  InstallAuth as InstallAuthValue,
  InstallTarget as InstallTargetValue,
} from './install-intent'
import {
  confirm,
  OnboardingInputToken,
  OnboardingResourceAccess,
  selectResources,
  selectSingle,
  type NumberedChoice,
  type OnboardingIO,
  type OnboardingResource,
} from './onboarding-prompts'

export {
  OnboardingResourceAccess,
  type OnboardingIO,
  type OnboardingResource,
} from './onboarding-prompts'

export const CodexOnboardingMode = CodexMode
export type CodexOnboardingMode = CodexModeValue

export type OnboardingInput = {
  readonly defaultTarget: InstallTargetValue; readonly defaultGatewayOrigin: string
  readonly defaultAuth: InstallAuthValue; readonly defaultCodexMode: CodexOnboardingMode
  readonly autoRouterMode: AutoRouterModeValue
  readonly searchTools: readonly OnboardingResource[]
  readonly mcpServers: readonly OnboardingResource[]; readonly mcpToolsets: readonly OnboardingResource[]
  readonly loadResources?: OnboardingResourceLoader
}

type CommonOnboardingPlan = {
  readonly gatewayOrigin: string; readonly auth: InstallAuthValue
  readonly autoRouter: Exclude<AutoRouterModeValue, typeof AutoRouterMode.Prompt>
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
  AutoRouterTitle: 'Optional LiteLLM Auto Router (Claude Code only)',
  AutoRouterPrompt: 'Choose whether to configure Auto Router; OpenCode and Codex stay unchanged',
  ConfirmPrompt: 'Apply this plan? [y/N]',
  InvalidOrigin: 'Enter an absolute http(s) origin without credentials, query, or fragment.',
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

type ResolvedAutoRouterMode = Exclude<AutoRouterModeValue, typeof AutoRouterMode.Prompt>

const AUTO_ROUTER_CHOICES: readonly NumberedChoice<ResolvedAutoRouterMode>[] = [
  { label: 'Skip (default)', value: AutoRouterMode.Skip },
  { label: 'Configure official LiteLLM Auto Router for Claude Code', value: AutoRouterMode.Configure },
]

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
  const autoRouter = await resolveAutoRouterMode(input.autoRouterMode, io)
  const plan: OnboardingPlan = {
    ...shape,
    gatewayOrigin,
    auth,
    autoRouter,
    searchTools,
    mcpServers,
    mcpToolsets,
  }

  io.write(JSON.stringify(plan, undefined, 2))
  if (!(await confirm(io, UiText.ConfirmPrompt))) {
    return failure(OnboardingFailureCode.Cancelled, UiText.Cancelled)
  }
  return { ok: true, plan }
}

async function resolveAutoRouterMode(
  mode: AutoRouterModeValue,
  io: OnboardingIO,
): Promise<ResolvedAutoRouterMode> {
  switch (mode) {
    case AutoRouterMode.Prompt:
      return selectSingle({
        io,
        title: UiText.AutoRouterTitle,
        prompt: UiText.AutoRouterPrompt,
        choices: AUTO_ROUTER_CHOICES,
        defaultValue: AutoRouterMode.Skip,
      })
    case AutoRouterMode.Skip:
    case AutoRouterMode.Configure:
    case AutoRouterMode.DryRun:
      return mode
    default:
      return assertNever(mode)
  }
}

async function selectGatewayOrigin(defaultOrigin: string, io: OnboardingIO): Promise<string> {
  while (true) {
    const raw = (await io.prompt(`${UiText.GatewayPrompt} [${defaultOrigin}]`)).trim()
    const origin = normalizeOrigin(raw === OnboardingInputToken.Default ? defaultOrigin : raw)
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
