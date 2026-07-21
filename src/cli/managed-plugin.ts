import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MANAGED_PLUGIN = { repository: 'https://github.com/happycastle114/opencode-litellm.git', revision: '83ea2674a8afb578a670188fb3b522fc242a77cb', checkoutDirectory: 'opencode-litellm-git', entrypoint: 'src/index.ts', remote: 'origin', packageLock: 'package-lock.json' } as const
const EXECUTABLE = { git: 'git', npm: 'npm', remote: MANAGED_PLUGIN.remote } as const

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

export type ManagedOpenCodePluginPlan = {
  readonly repository: string
  readonly revision: string
  readonly checkoutPath: string
  readonly entrypointPath: string
  readonly pluginSpec: string
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

export function planManagedOpenCodePlugin(
  options: ManagedPluginPlanOptions,
): ManagedOpenCodePluginPlan {
  if (!FULL_SHA_PATTERN.test(MANAGED_PLUGIN.revision)) {
    throw new ManagedPluginCheckoutError(
      'plan',
      options.opencodeConfigDir,
      'Managed plugin revision must be a full 40-character SHA',
    )
  }

  const checkoutPath = join(
    options.opencodeConfigDir,
    'vendor',
    MANAGED_PLUGIN.checkoutDirectory,
  )
  const entrypointPath = join(checkoutPath, MANAGED_PLUGIN.entrypoint)
  return {
    repository: MANAGED_PLUGIN.repository,
    revision: MANAGED_PLUGIN.revision,
    checkoutPath,
    entrypointPath,
    pluginSpec: pathToFileURL(entrypointPath).href,
  }
}

export async function ensureManagedOpenCodePlugin(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary = nodeBoundary(),
): Promise<ManagedOpenCodePluginPlan> {
  const checkoutExists = boundary.fs.exists(plan.checkoutPath)
  if (checkoutExists) {
    await verifyExistingCheckout(plan, boundary)
  } else {
    mkdirSync(dirname(plan.checkoutPath), { recursive: true })
    await runRequired(
      boundary,
      {
        executable: EXECUTABLE.git,
        args: [
          'clone',
          '--origin',
          MANAGED_PLUGIN.remote,
          plan.repository,
          plan.checkoutPath,
        ],
      },
      'clone',
      plan.checkoutPath,
    )
  }

  await runRequired(
    boundary,
    gitInvocation(plan.checkoutPath, [
      'fetch',
      '--prune',
      EXECUTABLE.remote,
      plan.revision,
    ]),
    'fetch',
    plan.checkoutPath,
  )
  await runRequired(
    boundary,
    gitInvocation(plan.checkoutPath, [
      'checkout',
      '--detach',
      plan.revision,
    ]),
    'checkout',
    plan.checkoutPath,
  )

  const head = await runRequired(
    boundary,
    gitInvocation(plan.checkoutPath, ['rev-parse', 'HEAD']),
    'verify revision',
    plan.checkoutPath,
  )
  if (head.stdout.trim() !== plan.revision) {
    throw new ManagedPluginCheckoutError(
      'verify revision',
      plan.checkoutPath,
      `Managed plugin checkout is not pinned to ${plan.revision}`,
    )
  }

  const lockPath = join(plan.checkoutPath, MANAGED_PLUGIN.packageLock)
  const installCommand = boundary.fs.exists(lockPath)
    ? 'ci'
    : 'install'
  await runRequired(
    boundary,
    {
      executable: EXECUTABLE.npm,
      args: [
        installCommand,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      cwd: plan.checkoutPath,
    },
    installCommand,
    plan.checkoutPath,
  )
  return plan
}

async function verifyExistingCheckout(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary,
): Promise<void> {
  const origin = await runRequired(
    boundary,
    gitInvocation(plan.checkoutPath, [
      'remote',
      'get-url',
      EXECUTABLE.remote,
    ]),
    'read origin',
    plan.checkoutPath,
  )
  if (origin.stdout.trim() !== plan.repository) {
    throw new ManagedPluginCheckoutError(
      'read origin',
      plan.checkoutPath,
      `Managed plugin origin must be ${plan.repository}`,
    )
  }

  const status = await runRequired(
    boundary,
    gitInvocation(plan.checkoutPath, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ]),
    'read status',
    plan.checkoutPath,
  )
  if (status.stdout.trim() !== '') {
    throw new ManagedPluginCheckoutError(
      'read status',
      plan.checkoutPath,
      'Managed plugin checkout has uncommitted changes',
    )
  }
}

function gitInvocation(
  checkoutPath: string,
  args: readonly string[],
): ManagedPluginCommandInvocation {
  return { executable: EXECUTABLE.git, args: ['-C', checkoutPath, ...args] }
}

async function runRequired(
  boundary: ManagedPluginBoundary,
  invocation: ManagedPluginCommandInvocation,
  operation: string,
  checkoutPath: string,
): Promise<ManagedPluginCommandResult> {
  const result = await boundary.command.run(invocation)
  if (result.exitCode !== 0) {
    throw new ManagedPluginCheckoutError(
      operation,
      checkoutPath,
      result.stderr.trim() || `Command exited with status ${result.exitCode}`,
    )
  }
  return result
}

function nodeBoundary(): ManagedPluginBoundary {
  return {
    fs: { exists: existsSync },
    command: { run: runNodeCommand },
  }
}

function runNodeCommand(
  invocation: ManagedPluginCommandInvocation,
): Promise<ManagedPluginCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.executable, [...invocation.args], {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout !== null) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
    }
    if (child.stderr !== null) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }
    child.on('error', (error: Error) => {
      resolve({ exitCode: 127, stdout, stderr: error.message })
    })
    child.on('close', (exitCode: number | null) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}
