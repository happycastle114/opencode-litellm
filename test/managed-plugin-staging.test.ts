import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMMAND_RESULT,
  FILE_SYSTEM_ERROR_CODE,
  MANAGED_PLUGIN,
  createBoundary,
  createRetryBoundary,
} from './managed-plugin-test-support'
import { ensureManagedOpenCodePlugin, planManagedOpenCodePlugin } from '../src/cli/managed-plugin'

describe('managed OpenCode plugin staging and recovery', () => {
  test('leaves the prior active checkout untouched when fetch fails in the new SHA directory', async () => {
    const opencodeConfigDir = mkdtempSync(join(tmpdir(), 'managed-plugin-fetch-'))
    const activePath = join(
      opencodeConfigDir,
      'vendor',
      MANAGED_PLUGIN.checkoutDirectory,
      '1111111111111111111111111111111111111111',
    )
    const activeHeadPath = join(activePath, '.git', 'HEAD')
    const activeDependencyPath = join(activePath, 'node_modules', 'preserved', 'index.js')
    mkdirSync(join(activePath, '.git'), { recursive: true })
    mkdirSync(join(activePath, 'node_modules', 'preserved'), { recursive: true })
    writeFileSync(activeHeadPath, 'old-head\n')
    writeFileSync(activeDependencyPath, 'old-dependency\n')
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })
    const fake = createBoundary(
      [COMMAND_RESULT.clean, COMMAND_RESULT.fetchFailure],
      (path) => path === activePath,
    )

    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toMatchObject({
      operation: 'fetch',
    })

    expect(readFileSync(activeHeadPath, 'utf8')).toBe('old-head\n')
    expect(readFileSync(activeDependencyPath, 'utf8')).toBe('old-dependency\n')
    expect(plan.checkoutPath).toBe(
      join(opencodeConfigDir, 'vendor', MANAGED_PLUGIN.checkoutDirectory, MANAGED_PLUGIN.revision),
    )
    expect(fake.calls.every((call) => call.cwd !== activePath && !call.args.includes(activePath))).toBe(true)
  })

  test('leaves the prior active checkout untouched when npm ci fails in the new SHA directory', async () => {
    const opencodeConfigDir = mkdtempSync(join(tmpdir(), 'managed-plugin-npm-'))
    const activePath = join(
      opencodeConfigDir,
      'vendor',
      MANAGED_PLUGIN.checkoutDirectory,
      '2222222222222222222222222222222222222222',
    )
    const activeHeadPath = join(activePath, '.git', 'HEAD')
    const activeDependencyPath = join(activePath, 'node_modules', 'preserved', 'index.js')
    mkdirSync(join(activePath, '.git'), { recursive: true })
    mkdirSync(join(activePath, 'node_modules', 'preserved'), { recursive: true })
    writeFileSync(activeHeadPath, 'old-head\n')
    writeFileSync(activeDependencyPath, 'old-dependency\n')
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })
    const fake = createBoundary(
      [
        COMMAND_RESULT.clean,
        COMMAND_RESULT.clean,
        COMMAND_RESULT.clean,
        COMMAND_RESULT.npmCiFailure,
      ],
      (path) => path === activePath,
    )

    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toMatchObject({
      operation: 'npm ci',
    })

    expect(readFileSync(activeHeadPath, 'utf8')).toBe('old-head\n')
    expect(readFileSync(activeDependencyPath, 'utf8')).toBe('old-dependency\n')
    const npmCall = fake.calls.at(-1)
    expect(npmCall?.executable).toBe('npm')
    expect(npmCall?.args).toEqual(['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
    expect(npmCall?.cwd).toMatch(new RegExp(`${MANAGED_PLUGIN.revision}\\.staging-`))
    expect(fake.calls.every((call) => call.cwd !== activePath && !call.args.includes(activePath))).toBe(true)
  })

  test('cleans failed npm ci staging so a later attempt can activate the exact SHA directory', async () => {
    const opencodeConfigDir = mkdtempSync(join(tmpdir(), 'managed-plugin-retry-'))
    const activePath = join(
      opencodeConfigDir,
      'vendor',
      MANAGED_PLUGIN.checkoutDirectory,
      '3333333333333333333333333333333333333333',
    )
    const activeHeadPath = join(activePath, '.git', 'HEAD')
    const activeDependencyPath = join(activePath, 'node_modules', 'preserved', 'index.js')
    mkdirSync(join(activePath, '.git'), { recursive: true })
    mkdirSync(join(activePath, 'node_modules', 'preserved'), { recursive: true })
    writeFileSync(activeHeadPath, 'old-head\n')
    writeFileSync(activeDependencyPath, 'old-dependency\n')
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })
    const fake = createRetryBoundary(activePath)

    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).rejects.toMatchObject({
      operation: 'npm ci',
    })
    await expect(ensureManagedOpenCodePlugin(plan, fake.boundary)).resolves.toEqual(plan)

    expect(fake.removedPaths).toEqual([fake.stagedPaths[0]])
    expect(fake.renamedPaths).toEqual([
      { source: fake.stagedPaths[1], destination: plan.checkoutPath },
    ])
    expect(fake.boundary.fs.exists(plan.checkoutPath)).toBe(true)
    expect(readFileSync(activeHeadPath, 'utf8')).toBe('old-head\n')
    expect(readFileSync(activeDependencyPath, 'utf8')).toBe('old-dependency\n')
    expect(fake.calls.every((call) => call.cwd !== activePath && !call.args.includes(activePath))).toBe(true)
  })

  test('propagates unexpected cleanup failures after staging errors', async () => {
    // Given: a staging failure whose cleanup turns a created parent into a file
    const opencodeConfigDir = mkdtempSync(join(tmpdir(), 'managed-plugin-cleanup-'))
    const plan = planManagedOpenCodePlugin({ opencodeConfigDir })
    const createdParent = join(
      opencodeConfigDir,
      'vendor',
      MANAGED_PLUGIN.checkoutDirectory,
    )
    const boundary = {
      fs: {
        exists: (path: string) => existsSync(path),
        isFile: () => true,
        remove: (path: string) => {
          rmSync(path, { recursive: true, force: true })
          rmSync(createdParent, { recursive: true, force: true })
          writeFileSync(createdParent, 'occupied')
        },
      },
      command: {
        run: async () => COMMAND_RESULT.npmCiFailure,
      },
    }

    try {
      // When: activation fails and cleanup encounters an unexpected filesystem error
      const installation = ensureManagedOpenCodePlugin(plan, boundary)

      // Then: the unexpected cleanup error is propagated instead of being swallowed
      await expect(installation).rejects.toMatchObject({ code: FILE_SYSTEM_ERROR_CODE.NotDirectory })
    } finally {
      rmSync(opencodeConfigDir, { recursive: true, force: true })
    }
  })
})
