import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  COMMAND_RESULT,
  CommandInvocation,
  createBoundary,
} from './managed-plugin-test-support'
import {
  MANAGED_PLUGIN_ACTIVATION_STATUS,
  ManagedPluginCheckoutError,
  activateManagedOpenCodePlugin,
  ensureManagedOpenCodePlugin,
  planManagedOpenCodePlugin,
} from '../src/cli/managed-plugin'

describe('managed OpenCode plugin checkout verification', () => {
  test('rejects a checkout whose origin differs before update commands run', async () => {
    // Given: an existing checkout reporting a foreign origin
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([COMMAND_RESULT.wrongOrigin])

    // When/Then: checkout preparation fails closed at the origin boundary
    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toBeInstanceOf(
      ManagedPluginCheckoutError,
    )
    expect(fake.calls).toHaveLength(1)
  })

  test('rejects a dirty checkout before fetch or detached checkout', async () => {
    // Given: the correct origin with local modifications
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([COMMAND_RESULT.correctOrigin, COMMAND_RESULT.dirty])

    // When/Then: checkout preparation preserves local work and stops
    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toBeInstanceOf(
      ManagedPluginCheckoutError,
    )
    expect(fake.calls).toHaveLength(2)
  })

  test('reuses an existing revision only after checking its dependency tree', async () => {
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([
      COMMAND_RESULT.correctOrigin,
      COMMAND_RESULT.clean,
      COMMAND_RESULT.correctHead,
      COMMAND_RESULT.clean,
    ])

    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).resolves.toEqual(plan)

    expect(fake.calls.filter((call) => call.executable === 'git').map(
      (call) => call.args.slice(2),
    )).toEqual([
      ['remote', 'get-url', 'origin'],
      ['status', '--porcelain', '--untracked-files=all'],
      ['rev-parse', 'HEAD'],
    ])
    expect(fake.calls.filter((call) => call.executable === 'npm')).toEqual([{
      executable: 'npm',
      args: ['ls', '--all', '--ignore-scripts'],
      cwd: plan.checkoutPath,
    }])
  })

  test('rejects an existing revision whose dependency tree is incomplete', async () => {
    // Given: a clean pinned checkout whose npm dependency validation fails
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([
      COMMAND_RESULT.correctOrigin,
      COMMAND_RESULT.clean,
      COMMAND_RESULT.correctHead,
      COMMAND_RESULT.npmCiFailure,
    ])

    // When: the existing immutable revision is verified
    const installation = ensureManagedOpenCodePlugin(plan, fake.boundary)

    // Then: it fails closed at deterministic dependency verification
    await expect(installation).rejects.toMatchObject({ operation: 'verify dependencies' })
    expect(fake.calls.at(-1)).toEqual({
      executable: 'npm',
      args: ['ls', '--all', '--ignore-scripts'],
      cwd: plan.checkoutPath,
    })
  })

  test('rejects a checkout whose managed entrypoint is not a regular file', async () => {
    // Given: a clean pinned checkout with a non-regular entrypoint
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const fake = createBoundary([
      COMMAND_RESULT.correctOrigin,
      COMMAND_RESULT.clean,
      COMMAND_RESULT.correctHead,
    ], () => true, () => false)

    // When: immutable checkout verification reaches the entrypoint boundary
    const installation = ensureManagedOpenCodePlugin(plan, fake.boundary)

    // Then: activation fails before dependency validation or config promotion
    await expect(installation).rejects.toMatchObject({ operation: 'verify entrypoint' })
    expect(fake.calls).toHaveLength(3)
  })

  test('adopts a concurrently published exact revision after activation collision', async () => {
    // Given: a staged exact revision and another installer winning final publication
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir: join(tmpdir(), 'opencode') })
    const existingPaths = new Set<string>()
    const removedPaths: string[] = []
    const calls: CommandInvocation[] = []
    const boundary = {
      fs: {
        exists: (path: string) => existingPaths.has(path),
        isFile: () => true,
        remove: (path: string) => {
          existingPaths.delete(path)
          removedPaths.push(path)
        },
        rename: (source: string, destination: string) => {
          existingPaths.add(destination)
          throw Object.assign(new Error('concurrent publication'), { code: 'EEXIST' })
        },
      },
      command: {
        run: async (invocation: CommandInvocation) => {
          calls.push(invocation)
          if (invocation.executable === 'git' && invocation.args[0] === 'clone') {
            const stagingPath = invocation.args.at(-1)
            if (stagingPath !== undefined) existingPaths.add(stagingPath)
          }
          if (invocation.args.includes('get-url')) {
            return COMMAND_RESULT.correctOrigin
          }
          if (invocation.args.includes('rev-parse')) {
            return COMMAND_RESULT.correctHead
          }
          return COMMAND_RESULT.clean
        },
      },
    }

    // When: activation verifies the winner after the exclusive destination collision
    const activation = await activateManagedOpenCodePlugin(plan, boundary)

    // Then: the verified winner is adopted and only the losing staging tree is removed
    expect(activation.status).toBe(MANAGED_PLUGIN_ACTIVATION_STATUS.Existing)
    expect(existingPaths.has(plan.checkoutPath)).toBe(true)
    expect(removedPaths).toHaveLength(1)
    expect(removedPaths[0]).toContain('.staging-')
    expect(calls.filter((call) => call.args.includes('get-url'))).toHaveLength(2)
  })
})
