import {
  MANAGED_OPEN_CODE_PLUGIN,
  MANAGED_PLUGIN_EXECUTABLE,
  MANAGED_PLUGIN_OPERATION,
  ManagedPluginCheckoutError,
  type ManagedOpenCodePluginPlan,
  type ManagedPluginBoundary,
  type ManagedPluginCommandInvocation,
  type ManagedPluginCommandResult,
} from './managed-plugin-types'

export async function verifyManagedPluginCheckout(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary,
): Promise<void> {
  const origin = await runRequiredManagedPluginCommand(
    boundary,
    managedPluginGitInvocation(plan.checkoutPath, [
      'remote',
      'get-url',
      MANAGED_OPEN_CODE_PLUGIN.remote,
    ]),
    MANAGED_PLUGIN_OPERATION.ReadOrigin,
    plan.checkoutPath,
  )
  if (origin.stdout.trim() !== plan.repository) {
    throw new ManagedPluginCheckoutError(
      MANAGED_PLUGIN_OPERATION.ReadOrigin,
      plan.checkoutPath,
      `Managed plugin origin must be ${plan.repository}`,
    )
  }

  const status = await runRequiredManagedPluginCommand(
    boundary,
    managedPluginGitInvocation(plan.checkoutPath, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ]),
    MANAGED_PLUGIN_OPERATION.ReadStatus,
    plan.checkoutPath,
  )
  if (status.stdout.trim() !== '') {
    throw new ManagedPluginCheckoutError(
      MANAGED_PLUGIN_OPERATION.ReadStatus,
      plan.checkoutPath,
      'Managed plugin checkout has uncommitted changes',
    )
  }

  const head = await runRequiredManagedPluginCommand(
    boundary,
    managedPluginGitInvocation(plan.checkoutPath, ['rev-parse', 'HEAD']),
    MANAGED_PLUGIN_OPERATION.VerifyRevision,
    plan.checkoutPath,
  )
  if (head.stdout.trim() !== plan.revision) {
    throw new ManagedPluginCheckoutError(
      MANAGED_PLUGIN_OPERATION.VerifyRevision,
      plan.checkoutPath,
      `Managed plugin checkout is not pinned to ${plan.revision}`,
    )
  }
  if (!boundary.fs.isFile(plan.entrypointPath)) {
    throw new ManagedPluginCheckoutError(
      MANAGED_PLUGIN_OPERATION.VerifyEntrypoint,
      plan.checkoutPath,
      `Managed plugin entrypoint must be a regular file: ${plan.entrypointPath}`,
    )
  }
  await runRequiredManagedPluginCommand(
    boundary,
    {
      executable: MANAGED_PLUGIN_EXECUTABLE.Npm,
      args: ['ls', '--all', '--ignore-scripts'],
      cwd: plan.checkoutPath,
    },
    MANAGED_PLUGIN_OPERATION.VerifyDependencies,
    plan.checkoutPath,
  )
}

export function managedPluginGitInvocation(
  checkoutPath: string,
  args: readonly string[],
): ManagedPluginCommandInvocation {
  return {
    executable: MANAGED_PLUGIN_EXECUTABLE.Git,
    args: ['-C', checkoutPath, ...args],
  }
}

export async function runRequiredManagedPluginCommand(
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
