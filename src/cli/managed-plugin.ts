import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { nodeManagedPluginBoundary } from './managed-plugin-node-boundary'
import {
  MANAGED_OPEN_CODE_PLUGIN,
  MANAGED_PLUGIN_ACTIVATION_STATUS,
  MANAGED_PLUGIN_EXECUTABLE,
  MANAGED_PLUGIN_FULL_SHA_PATTERN,
  MANAGED_PLUGIN_OPERATION,
  ManagedPluginCheckoutError,
  type ManagedOpenCodePluginActivation,
  type ManagedOpenCodePluginPlan,
  type ManagedPluginBoundary,
  type ManagedPluginPlanOptions,
} from './managed-plugin-types'
import {
  managedPluginGitInvocation,
  runRequiredManagedPluginCommand,
  verifyManagedPluginCheckout,
} from './managed-plugin-verification'

const DIRECTORY_MODE = 0o700
const FILE_PROTOCOL = 'file:' as const
const DIRECTORY_CLEANUP_ERROR_CODE = { NotFound: 'ENOENT' } as const

export {
  MANAGED_PLUGIN_ACTIVATION_STATUS,
  ManagedPluginCheckoutError,
  type ManagedOpenCodePluginActivation,
  type ManagedOpenCodePluginPlan,
  type ManagedPluginBoundary,
  type ManagedPluginCommandInvocation,
  type ManagedPluginCommandResult,
  type ManagedPluginPlanOptions,
} from './managed-plugin-types'

export function isManagedOpenCodePluginSpec(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== FILE_PROTOCOL || url.search !== '' || url.hash !== '') return false

  let path: string
  try { path = fileURLToPath(url) } catch { return false }
  const segments = path.split('/')
  const checkoutIndex = segments.lastIndexOf(MANAGED_OPEN_CODE_PLUGIN.checkoutDirectory)
  if (checkoutIndex < 0) return false
  const suffix = segments.slice(checkoutIndex + 1)
  if (suffix.length === 2) {
    return suffix.join('/') === MANAGED_OPEN_CODE_PLUGIN.entrypoint
  }
  return suffix.length === 3 &&
    suffix.slice(1).join('/') === MANAGED_OPEN_CODE_PLUGIN.entrypoint &&
    MANAGED_PLUGIN_FULL_SHA_PATTERN.test(suffix[0])
}

export function planManagedOpenCodePlugin(
  options: ManagedPluginPlanOptions,
): ManagedOpenCodePluginPlan {
  if (!MANAGED_PLUGIN_FULL_SHA_PATTERN.test(MANAGED_OPEN_CODE_PLUGIN.revision)) {
    throw new ManagedPluginCheckoutError(
      MANAGED_PLUGIN_OPERATION.Plan,
      options.opencodeConfigDir,
      'Managed plugin revision must be a full 40-character SHA',
    )
  }
  const checkoutPath = join(
    options.opencodeConfigDir,
    'vendor',
    MANAGED_OPEN_CODE_PLUGIN.checkoutDirectory,
    MANAGED_OPEN_CODE_PLUGIN.revision,
  )
  return planAtCheckoutPath({
    repository: MANAGED_OPEN_CODE_PLUGIN.repository,
    revision: MANAGED_OPEN_CODE_PLUGIN.revision,
    checkoutPath,
    entrypointPath: '',
    pluginSpec: '',
  }, checkoutPath)
}

export async function ensureManagedOpenCodePlugin(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary = nodeManagedPluginBoundary(),
): Promise<ManagedOpenCodePluginPlan> {
  const activation = await activateManagedOpenCodePlugin(plan, boundary)
  completeManagedOpenCodePluginActivation(activation)
  return activation.plan
}

export async function activateManagedOpenCodePlugin(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary = nodeManagedPluginBoundary(),
): Promise<ManagedOpenCodePluginActivation> {
  if (boundary.fs.exists(plan.checkoutPath)) {
    await verifyManagedPluginCheckout(plan, boundary)
    return { plan, status: MANAGED_PLUGIN_ACTIVATION_STATUS.Existing }
  }

  const createdParents = createCheckoutParents(dirname(plan.checkoutPath))
  const stagingPath = `${plan.checkoutPath}.staging-${randomUUID()}`
  const stagedPlan = planAtCheckoutPath(plan, stagingPath)
  let status: ManagedOpenCodePluginActivation['status'] =
    MANAGED_PLUGIN_ACTIVATION_STATUS.New
  try {
    await prepareStagedCheckout(stagedPlan, boundary)
    try {
      activateCheckout(stagingPath, plan.checkoutPath, boundary)
    } catch (error) {
      if (!boundary.fs.exists(plan.checkoutPath)) throw error
      await verifyManagedPluginCheckout(plan, boundary)
      status = MANAGED_PLUGIN_ACTIVATION_STATUS.Existing
    }
  } catch (error) {
    removeStagingCheckout(stagingPath, boundary)
    removeEmptyCheckoutParents(createdParents)
    throw error
  }
  if (status === MANAGED_PLUGIN_ACTIVATION_STATUS.Existing) {
    removeStagingCheckout(stagingPath, boundary)
  }
  return { plan, status }
}

export function rollbackManagedOpenCodePluginActivation(
  _activation: ManagedOpenCodePluginActivation,
  _boundary: ManagedPluginBoundary = nodeManagedPluginBoundary(),
): void {
}

export function completeManagedOpenCodePluginActivation(
  _activation: ManagedOpenCodePluginActivation,
): void {
}

async function prepareStagedCheckout(
  plan: ManagedOpenCodePluginPlan,
  boundary: ManagedPluginBoundary,
): Promise<void> {
  await runRequiredManagedPluginCommand(boundary, {
    executable: MANAGED_PLUGIN_EXECUTABLE.Git,
    args: [
      MANAGED_PLUGIN_OPERATION.Clone,
      '--origin',
      MANAGED_OPEN_CODE_PLUGIN.remote,
      plan.repository,
      plan.checkoutPath,
    ],
  }, MANAGED_PLUGIN_OPERATION.Clone, plan.checkoutPath)
  await runRequiredManagedPluginCommand(boundary, managedPluginGitInvocation(
    plan.checkoutPath,
    ['fetch', '--prune', MANAGED_OPEN_CODE_PLUGIN.remote, plan.revision],
  ), MANAGED_PLUGIN_OPERATION.Fetch, plan.checkoutPath)
  await runRequiredManagedPluginCommand(boundary, managedPluginGitInvocation(
    plan.checkoutPath,
    ['checkout', '--detach', plan.revision],
  ), MANAGED_PLUGIN_OPERATION.Checkout, plan.checkoutPath)
  await runRequiredManagedPluginCommand(boundary, {
    executable: MANAGED_PLUGIN_EXECUTABLE.Npm,
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    cwd: plan.checkoutPath,
  }, MANAGED_PLUGIN_OPERATION.NpmCi, plan.checkoutPath)
  await verifyManagedPluginCheckout(plan, boundary)
}

function planAtCheckoutPath(
  plan: ManagedOpenCodePluginPlan,
  checkoutPath: string,
): ManagedOpenCodePluginPlan {
  const entrypointPath = join(checkoutPath, MANAGED_OPEN_CODE_PLUGIN.entrypoint)
  return {
    ...plan,
    checkoutPath,
    entrypointPath,
    pluginSpec: pathToFileURL(entrypointPath).href,
  }
}

function activateCheckout(
  stagingPath: string,
  checkoutPath: string,
  boundary: ManagedPluginBoundary,
): void {
  if (boundary.fs.rename !== undefined) {
    boundary.fs.rename(stagingPath, checkoutPath)
    return
  }
  if (boundary.fs.exists(stagingPath)) renameSync(stagingPath, checkoutPath)
}

function removeStagingCheckout(
  stagingPath: string,
  boundary: ManagedPluginBoundary,
): void {
  if (boundary.fs.remove !== undefined) {
    boundary.fs.remove(stagingPath)
    return
  }
  if (boundary.fs.exists(stagingPath)) {
    rmSync(stagingPath, { recursive: true, force: true })
  }
}

function createCheckoutParents(path: string): readonly string[] {
  const missing: string[] = []
  let current = path
  while (!existsSync(current)) {
    missing.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const directory of [...missing].reverse()) {
    mkdirSync(directory, { mode: DIRECTORY_MODE })
  }
  return missing
}

function removeEmptyCheckoutParents(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      rmdirSync(path)
    } catch (error) {
      if (!isFileSystemError(error) ||
        error.code !== DIRECTORY_CLEANUP_ERROR_CODE.NotFound) throw error
    }
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
