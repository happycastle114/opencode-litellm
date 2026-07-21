import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPPORTED_NODE_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0'
const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const wrapperRoot = join(repositoryRoot, 'packages', 'codex-litellm')

test('publishes the dependency-compatible Node engine contract', () => {
  // Given: the core and wrapper package manifests
  const core = readJsonObject(join(repositoryRoot, 'package.json'))
  const wrapper = readJsonObject(join(wrapperRoot, 'package.json'))

  // When: npm reads their runtime engine contracts
  const engineContracts = [core.engines, wrapper.engines]

  // Then: both packages expose the exact floor required by the runtime graph
  expect(engineContracts).toEqual([
    { node: SUPPORTED_NODE_RANGE },
    { node: SUPPORTED_NODE_RANGE },
  ])
})

test('installs both packed packages with engine-strict and runs them on a supported Node', () => {
  // Given: publish-shaped tarballs for the core and wrapper
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencode-litellm-engine-test-'))
  try {
    const coreTarball = packPackage(repositoryRoot, fixtureRoot)
    const wrapperTarball = packPackage(wrapperRoot, fixtureRoot)
    const consumerRoot = join(fixtureRoot, 'consumer')
    mkdirSync(consumerRoot)
    writeFileSync(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify({ name: 'engine-contract-consumer', private: true, version: '0.0.0' })}\n`,
    )

    // When: npm enforces engines while installing the actual package artifacts
    const installed = spawnSync(
      'npm',
      [
        'install',
        '--offline',
        '--engine-strict',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        coreTarball,
        wrapperTarball,
      ],
      {
        cwd: consumerRoot,
        encoding: 'utf8',
        env: { ...process.env, npm_config_engine_strict: 'true' },
      },
    )

    // Then: npm accepts the dependency graph and Node executes both entrypoints
    expectCommandSucceeded(installed, 'engine-strict install')
    const core = readJsonObject(
      join(consumerRoot, 'node_modules', '@happycastle114', 'opencode-litellm', 'package.json'),
    )
    const wrapper = readJsonObject(
      join(consumerRoot, 'node_modules', '@happycastle114', 'codex-litellm', 'package.json'),
    )
    expect(core.engines).toEqual({ node: SUPPORTED_NODE_RANGE })
    expect(wrapper.engines).toEqual({ node: SUPPORTED_NODE_RANGE })

    const coreHelp = spawnSync(
      'node',
      [
        join(
          consumerRoot,
          'node_modules',
          '@happycastle114',
          'opencode-litellm',
          'dist',
          'opencode-litellm.mjs',
        ),
        '--help',
      ],
      { cwd: consumerRoot, encoding: 'utf8', env: process.env },
    )
    expectCommandSucceeded(coreHelp, 'core runtime')

    const wrapperHelp = spawnSync(
      'node',
      [join(consumerRoot, 'node_modules', '@happycastle114', 'codex-litellm', 'bin', 'codex-litellm.mjs'), '--help'],
      { cwd: consumerRoot, encoding: 'utf8', env: process.env },
    )
    expectCommandSucceeded(wrapperHelp, 'wrapper runtime')
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}, 30_000)

function packPackage(packageRoot: string, destination: string): string {
  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: packageRoot, encoding: 'utf8', env: process.env },
  )
  expectCommandSucceeded(packed, `pack ${packageRoot}`)
  const inventory: unknown = JSON.parse(packed.stdout)
  if (!Array.isArray(inventory) || !isRecord(inventory[0])) {
    throw new Error(`npm pack returned an invalid inventory for ${packageRoot}`)
  }
  const filename = inventory[0].filename
  if (typeof filename !== 'string') {
    throw new Error(`npm pack returned no filename for ${packageRoot}`)
  }
  return isAbsolute(filename) ? filename : join(destination, filename)
}

function expectCommandSucceeded(
  result: Readonly<{ status: number | null; stdout: string; stderr: string }>,
  operation: string,
): void {
  if (result.status !== 0) {
    throw new Error(
      `${operation} failed (${String(result.status)}): ${result.stdout}${result.stderr}`,
    )
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object at ${path}`)
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
