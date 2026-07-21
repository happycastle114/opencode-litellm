export const MANAGED_OPEN_CODE_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: '83ea2674a8afb578a670188fb3b522fc242a77cb',
  checkoutDirectory: 'opencode-litellm-git',
  entrypoint: 'src/index.ts',
  remote: 'origin',
} as const

export const MANAGED_PLUGIN_EXECUTABLE = {
  Git: 'git',
  Npm: 'npm',
} as const

export const MANAGED_PLUGIN_OPERATION = {
  Checkout: 'checkout',
  Clone: 'clone',
  Fetch: 'fetch',
  NpmCi: 'npm ci',
  Plan: 'plan',
  ReadOrigin: 'read origin',
  ReadStatus: 'read status',
  VerifyDependencies: 'verify dependencies',
  VerifyEntrypoint: 'verify entrypoint',
  VerifyRevision: 'verify revision',
} as const

export const MANAGED_PLUGIN_ACTIVATION_STATUS = {
  Existing: 'existing',
  New: 'new',
} as const

export const MANAGED_PLUGIN_FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

export type ManagedOpenCodePluginPlan = {
  readonly repository: string
  readonly revision: string
  readonly checkoutPath: string
  readonly entrypointPath: string
  readonly pluginSpec: string
}

export type ManagedOpenCodePluginActivation = {
  readonly plan: ManagedOpenCodePluginPlan
  readonly status: typeof MANAGED_PLUGIN_ACTIVATION_STATUS[
    keyof typeof MANAGED_PLUGIN_ACTIVATION_STATUS
  ]
}

export type ManagedPluginPlanOptions = {
  readonly opencodeConfigDir: string
}

export type ManagedPluginCommandInvocation = {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd?: string
}

export type ManagedPluginCommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type ManagedPluginBoundary = {
  readonly fs: {
    readonly exists: (path: string) => boolean
    readonly isFile: (path: string) => boolean
    readonly rename?: (source: string, destination: string) => void
    readonly remove?: (path: string) => void
  }
  readonly command: {
    readonly run: (
      invocation: ManagedPluginCommandInvocation,
    ) => Promise<ManagedPluginCommandResult>
  }
}

export class ManagedPluginCheckoutError extends Error {
  readonly name = 'ManagedPluginCheckoutError'

  constructor(
    readonly operation: string,
    readonly checkoutPath: string,
    message: string,
  ) {
    super(`${message} (${operation}: ${checkoutPath})`)
  }
}
