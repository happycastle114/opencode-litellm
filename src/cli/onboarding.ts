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
  renderBanner,
  renderStep,
  renderSummary,
  renderWarning,
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
  readonly defaultTarget: InstallTargetValue; readonly defaultGatewayOrigin: string | undefined
  readonly defaultAuth: InstallAuthValue; readonly defaultCodexMode: CodexOnboardingMode
  readonly autoRouterMode: AutoRouterModeValue
  readonly searchTools: readonly OnboardingResource[]
  readonly mcpServers: readonly OnboardingResource[]; readonly mcpToolsets: readonly OnboardingResource[]
  readonly models?: readonly OnboardingResource[]
  readonly codexFallbackModel?: string
  readonly loadResources?: OnboardingResourceLoader
}

type CommonOnboardingPlan = {
  readonly gatewayOrigin: string; readonly auth: InstallAuthValue
  readonly autoRouter: Exclude<AutoRouterModeValue, typeof AutoRouterMode.Prompt>
  readonly defaultModel: string | undefined
  readonly codexFallbackModel?: string
  readonly searchTools: readonly string[]; readonly mcpServers: readonly string[]
  readonly mcpToolsets: readonly string[]
}

export type OnboardingPlan =
  | (CommonOnboardingPlan & { readonly target: typeof InstallTarget.OpenCode })
  | (CommonOnboardingPlan & {
      readonly target: typeof InstallTarget.Codex | typeof InstallTarget.Both
      readonly codexMode: CodexOnboardingMode
    })

export const OnboardingFailureCode = {
  TtyRequired: 'tty-required', Cancelled: 'cancelled', InvalidFallbackModel: 'invalid-fallback-model',
} as const
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
> & {
  readonly models?: readonly OnboardingResource[]
}

export type OnboardingResourceLoader = (
  connection: OnboardingConnection,
) => Promise<OnboardingResources>

const UiText = {
  TargetTitle: 'Install target',
  TargetPrompt: 'Choose a number',
  GatewayPrompt: 'Gateway URL',
  AuthTitle: 'Authentication method',
  AuthPrompt: 'Choose a number',
  CodexTitle: 'Codex connection mode',
  CodexPrompt: 'Choose a number',
  ModelTitle: 'Default model',
  ModelPrompt: 'Choose a number (Enter for auto)',
  SearchTitle: 'Search tools',
  McpTitle: 'MCP servers',
  ToolsetTitle: 'MCP toolsets',
  AutoRouterTitle: 'Auto Router (Claude Code only, optional)',
  AutoRouterPrompt: 'Choose a number',
  ConfirmPrompt: 'Apply this plan?',
  InvalidOrigin: 'Please enter a valid URL like https://your-gateway.com',
  Cancelled: 'Installation cancelled.',
  TtyRequired:
    'This terminal does not support interactive mode. Re-run with --non-interactive and provide install options as flags.',
} as const

const MODEL_INDEX_PATTERN = /^[1-9]\d*$/

const TARGET_CHOICES: readonly NumberedChoice<InstallTargetValue>[] = [
  { label: 'OpenCode', value: InstallTarget.OpenCode }, { label: 'Codex', value: InstallTarget.Codex },
  { label: 'Both', value: InstallTarget.Both },
]

const AUTH_CHOICES: readonly NumberedChoice<InstallAuthValue>[] = [
  { label: 'Gateway browser login (SSO; needs lite CLI)', value: InstallAuth.Sso },
  { label: 'Gateway API key (stored locally; no lite CLI needed)', value: InstallAuth.Environment },
]

const CODEX_CHOICES: readonly NumberedChoice<CodexOnboardingMode>[] = [
  { label: 'LiteLLM only', value: CodexMode.Gateway },
  { label: 'Subscription via server (requires gateway extension)', value: CodexMode.OAuth },
  { label: 'Separate profiles (manual switch; server extension needed)', value: CodexMode.Both },
  { label: 'Subscription + LiteLLM: server switch (requires extension)', value: CodexMode.HybridServer },
  { label: 'Subscription + LiteLLM: local switch (standard gateway)', value: CodexMode.HybridClient },
]

type ResolvedAutoRouterMode = Exclude<AutoRouterModeValue, typeof AutoRouterMode.Prompt>

const AUTO_ROUTER_CHOICES: readonly NumberedChoice<ResolvedAutoRouterMode>[] = [
  { label: 'Skip (recommended)', value: AutoRouterMode.Skip },
  { label: 'Configure Auto Router for Claude Code', value: AutoRouterMode.Configure },
]

export async function runInstallOnboarding(
  input: OnboardingInput,
  io: OnboardingIO,
): Promise<OnboardingResult> {
  if (!io.isTTY) {
    return failure(OnboardingFailureCode.TtyRequired, UiText.TtyRequired)
  }

  io.write(renderBanner())

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
  const hybrid = 'codexMode' in shape &&
    (shape.codexMode === CodexMode.HybridClient || shape.codexMode === CodexMode.HybridServer)
  const models = resources.models ?? []
  if (hybrid && !models.some((model) => model.access === OnboardingResourceAccess.Available &&
    (input.codexFallbackModel === undefined || model.name === input.codexFallbackModel))) {
    return failure(OnboardingFailureCode.InvalidFallbackModel,
      'Hybrid mode needs an available paid chat model. Check gateway model access or --codex-fallback-model, then rerun install.')
  }
  if (hybrid) {
    io.write('  Auto starts with your subscription. When its quota is exhausted,')
    io.write('  it uses your chosen LiteLLM model and may incur charges.')
    io.write('  Choose Subscription in /model to stay on subscription only.')
  }
  const codexFallbackModel = hybrid
    ? input.codexFallbackModel ?? await selectDefaultModel(models, io, true)
    : undefined
  const defaultModel = consumesDefaultModel(shape)
    ? await selectDefaultModel(models, io)
    : undefined
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
    defaultModel,
    ...(codexFallbackModel === undefined ? {} : { codexFallbackModel }),
    searchTools,
    mcpServers,
    mcpToolsets,
  }

  io.write(renderStep('Summary'))
  io.write(renderSummary([
    ['Target', targetLabel(target)],
    ['Gateway', gatewayOrigin],
    ['Auth', authLabel(auth)],
    ...('codexMode' in shape ? [['Codex mode', codexModeLabel(shape.codexMode)] as const] : []),
    ...('codexMode' in shape && defaultModel !== undefined ? [['Default model', defaultModel] as const] : []),
    ...(codexFallbackModel === undefined ? [] : [['Paid fallback', codexFallbackModel] as const]),
    ['Search tools', searchTools.length > 0 ? `${searchTools.length} selected` : 'none'],
    ['MCP servers', mcpServers.length > 0 ? `${mcpServers.length} selected` : 'none'],
    ['MCP toolsets', mcpToolsets.length > 0 ? `${mcpToolsets.length} selected` : 'none'],
  ]))

  if (!(await confirm(io, UiText.ConfirmPrompt))) {
    io.write(renderWarning(UiText.Cancelled))
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

async function selectGatewayOrigin(defaultOrigin: string | undefined, io: OnboardingIO): Promise<string> {
  io.write(renderStep('Gateway URL'))
  while (true) {
    const suffix = defaultOrigin !== undefined ? ` \x1b[2m[${defaultOrigin}]\x1b[22m` : ''
    const raw = (await io.prompt(`\x1b[36m▸\x1b[39m ${UiText.GatewayPrompt}${suffix}: `)).trim()
    const resolved = raw === OnboardingInputToken.Default ? defaultOrigin : raw
    if (resolved === undefined || resolved === '') {
      io.write(renderWarning('A gateway URL is required. Example: https://your-gateway.com'))
      continue
    }
    const origin = normalizeOrigin(resolved)
    if (origin !== undefined) return origin
    io.write(renderWarning(UiText.InvalidOrigin))
  }
}

async function selectDefaultModel(
  models: readonly OnboardingResource[],
  io: OnboardingIO,
  paidFallback = false,
): Promise<string | undefined> {
  const names = models
    .filter((model) => model.access === OnboardingResourceAccess.Available)
    .map((model) => model.name)
  if (names.length === 0) return undefined
  io.write(renderStep(paidFallback ? 'Paid fallback model' : UiText.ModelTitle))
  names.forEach((name, index) => io.write(`  \x1b[36m${index + 1}.\x1b[39m ${name}`))
  while (true) {
    const prompt = paidFallback ? 'Choose a paid model (required)' : UiText.ModelPrompt
    const raw = (await io.prompt(`\x1b[36m▸\x1b[39m \x1b[2m${prompt} [1-${names.length}]\x1b[22m `)).trim()
    if (!paidFallback && raw === OnboardingInputToken.Default) return undefined
    if (names.includes(raw)) return raw
    if (MODEL_INDEX_PATTERN.test(raw)) {
      const selected = names[Number.parseInt(raw, 10) - 1]
      if (selected !== undefined) return selected
    }
    io.write(renderWarning(paidFallback
      ? `Choose a paid model from 1 to ${names.length}. Enter cannot select one for you.`
      : `Choose a model number from 1 to ${names.length}, or press Enter for auto.`))
  }
}

function consumesDefaultModel(shape: OnboardingShape): boolean {
  if (shape.target === InstallTarget.OpenCode) return false
  return shape.codexMode === CodexMode.Gateway || shape.codexMode === CodexMode.Both
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

function targetLabel(target: InstallTargetValue): string {
  switch (target) {
    case InstallTarget.OpenCode: return 'OpenCode'
    case InstallTarget.Codex: return 'Codex'
    case InstallTarget.Both: return 'OpenCode + Codex'
    default: return assertNever(target)
  }
}

function authLabel(auth: InstallAuthValue): string {
  switch (auth) {
    case InstallAuth.Sso: return 'LiteLLM SSO'
    case InstallAuth.Environment: return 'API key (stored locally)'
    default: return assertNever(auth)
  }
}

function codexModeLabel(mode: CodexModeValue): string {
  switch (mode) {
    case CodexMode.Gateway: return 'Gateway'
    case CodexMode.OAuth: return 'OAuth pass-through'
    case CodexMode.Both: return 'Both (gateway + OAuth)'
    case CodexMode.HybridServer: return 'Hybrid (server routing)'
    case CodexMode.HybridClient: return 'Hybrid (client routing)'
    default: return assertNever(mode)
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
