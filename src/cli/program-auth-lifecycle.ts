import { join } from 'node:path'
import { parseAuthCommandOptions } from './auth-command-options'
import {
  AuthInspectionStatus,
  inspectLiteLLMAuth,
  logoutLiteLLMAuth,
} from './auth-lifecycle'
import {
  clearCodexSessionEnvironment,
  syncCodexSessionEnvironment,
  type CodexEnvironmentBoundary,
} from './client-installer-codex-environment'
import type { CliResult } from './command'
import {
  onboardLiteLLMSso,
  type SsoOnboardingBoundaries,
  type SsoOnboardingInput,
} from './onboarding-sso'
import { PathResolutionError } from './paths'
import { withClientInstallPlanningLock } from './client-install-planning-lock'

const AUTH_COMMAND = {
  Login: 'login',
  Logout: 'logout',
  WhoAmI: 'whoami',
} as const
const TOKEN_PATH = ['.litellm', 'token.json'] as const

export type ProgramAuthCommand = (typeof AUTH_COMMAND)[keyof typeof AUTH_COMMAND]

export type ProgramAuthContext = CodexEnvironmentBoundary & {
  readonly now: () => Date
  readonly ssoBoundaries?: SsoOnboardingBoundaries
  readonly ssoOnboarding?: (
    input: SsoOnboardingInput,
  ) => ReturnType<typeof onboardLiteLLMSso>
}

export async function runAuthLifecycleCommand(
  command: ProgramAuthCommand,
  argv: readonly string[],
  context: ProgramAuthContext,
): Promise<CliResult> {
  const parsed = parseAuthCommandOptions(argv)
  if (!parsed.ok) return failure(parsed.message)
  const homeDirectory = resolveHome(context.env)
  const tokenFilePath = join(homeDirectory, ...TOKEN_PATH)
  if (command === AUTH_COMMAND.WhoAmI) {
    return inspectAuth(parsed.options.baseUrl, tokenFilePath)
  }
  return withClientInstallPlanningLock(homeDirectory, async () => {
    return mutateAuth(command, parsed.options, tokenFilePath, homeDirectory, context)
  })
}

async function mutateAuth(
  command: Exclude<ProgramAuthCommand, typeof AUTH_COMMAND.WhoAmI>,
  options: { readonly baseUrl: string; readonly authEnv: string },
  tokenFilePath: string,
  homeDirectory: string,
  context: ProgramAuthContext,
): Promise<CliResult> {
  switch (command) {
    case AUTH_COMMAND.Login:
      if (context.ssoBoundaries === undefined) {
        return failure('LiteLLM SSO login requires an interactive browser boundary.')
      }
      await (context.ssoOnboarding ?? onboardLiteLLMSso)({
        baseUrl: options.baseUrl,
        tokenFilePath,
        now: () => context.now().getTime(),
        boundaries: context.ssoBoundaries,
      })
      return lifecycleResult(
        `Authenticated LiteLLM SSO for ${options.baseUrl}.`,
        syncCodexSessionEnvironment(
          options.authEnv,
          context,
          homeDirectory,
        ),
        false,
      )
    case AUTH_COMMAND.Logout: {
      const result = logoutLiteLLMAuth({ tokenFilePath })
      return lifecycleResult(
        `LiteLLM SSO session ${result.status}.`,
        clearCodexSessionEnvironment(options.authEnv, context),
        true,
      )
    }
    default:
      return assertNever(command)
  }
}

function inspectAuth(baseUrl: string, tokenFilePath: string): CliResult {
  const inspection = inspectLiteLLMAuth({ baseUrl, tokenFilePath })
  return {
    exitCode: inspection.status === AuthInspectionStatus.Authenticated ? 0 : 1,
    stdout: `${JSON.stringify(inspection, null, 2)}\n`,
    stderr: '',
  }
}

function resolveHome(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (env.HOME !== undefined && env.HOME !== '') return env.HOME
  throw new PathResolutionError('Unable to resolve HOME for LiteLLM client assets.')
}

function lifecycleResult(
  message: string,
  warnings: readonly string[],
  failOnWarning: boolean,
): CliResult {
  return {
    exitCode: failOnWarning && warnings.length > 0 ? 1 : 0,
    stdout: `${message}\n`,
    stderr: warnings.map((warning) => `Warning: ${warning}`).join('\n') +
      (warnings.length === 0 ? '' : '\n'),
  }
}

function failure(message: string): CliResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected auth lifecycle command: ${String(value)}`)
}
