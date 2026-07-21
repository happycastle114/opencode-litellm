import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
export const coreManifestPath = join(repositoryRoot, 'package.json')
export const wrapperRoot = join(repositoryRoot, 'packages', 'codex-litellm')
export const wrapperManifestPath = join(wrapperRoot, 'package.json')
export const wrapperEntrypoint = join(wrapperRoot, 'bin', 'codex-litellm.mjs')

export type JsonObject = Record<string, unknown>

export type NodeRuntime = {
  readonly executable: string
  readonly version: string
}

export type PackEntry = {
  readonly filename: string
  readonly files: readonly { readonly path: string }[]
}

let cachedNodeRuntime: NodeRuntime | undefined
let cachedNpmExecutable: string | undefined

export function readJsonObject(path: string): JsonObject {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object at ${path}.`)
  return parsed
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getNodeRuntime(): NodeRuntime {
  if (cachedNodeRuntime) return cachedNodeRuntime

  const executable = resolveExecutableFromPath('node')
  const versionProbe = spawnSync(executable, ['--version'], { encoding: 'utf8' })
  if (versionProbe.status !== 0) {
    throw new Error(`Node version probe failed: ${versionProbe.stderr || versionProbe.stdout}`)
  }
  const version = versionProbe.stdout.trim()
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
    throw new Error(`Unexpected node version: ${version}`)
  }
  const identityProbe = spawnSync(
    executable,
    ['-e', "process.stdout.write(JSON.stringify({ executable: process.execPath, release: process.release.name, version: process.version }))"],
    { encoding: 'utf8' },
  )
  if (identityProbe.status !== 0) {
    throw new Error(`Node identity probe failed: ${identityProbe.stderr || identityProbe.stdout}`)
  }
  const identity: unknown = JSON.parse(identityProbe.stdout)
  if (!isRecord(identity) || identity.release !== 'node' || identity.version !== version) {
    throw new Error('PATH node identity did not match the version probe')
  }
  if (typeof identity.executable !== 'string' || realpathSync(identity.executable) !== realpathSync(executable)) {
    throw new Error('PATH node identity did not match the executable')
  }
  cachedNodeRuntime = { executable, version }
  return cachedNodeRuntime
}

export function getNpmExecutable(): string {
  if (cachedNpmExecutable) return cachedNpmExecutable
  cachedNpmExecutable = resolveExecutableFromPath('npm')
  return cachedNpmExecutable
}

export function packPackage(packageRoot: string, destination: string): PackEntry {
  const packed = spawnSync(
    getNpmExecutable(),
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: packageRoot, encoding: 'utf8' },
  )
  expectCommandSucceeded(packed, `pack ${packageRoot}`)
  const inventory: unknown = JSON.parse(packed.stdout)
  if (!Array.isArray(inventory) || !isRecord(inventory[0])) {
    throw new Error(`npm pack returned an invalid inventory for ${packageRoot}`)
  }
  const entry = inventory[0]
  const filename = entry.filename
  const files = entry.files
  if (typeof filename !== 'string' || !Array.isArray(files)) {
    throw new Error(`npm pack returned an incomplete inventory for ${packageRoot}`)
  }
  const paths = files.flatMap((file) =>
    isRecord(file) && typeof file.path === 'string' ? [{ path: file.path }] : [],
  )
  if (paths.length !== files.length) throw new Error(`npm pack returned an invalid file list for ${packageRoot}`)
  return { filename: isAbsolute(filename) ? filename : join(destination, filename), files: paths }
}

export function createConsumer(root: string, name: string): string {
  const consumerRoot = join(root, 'consumer')
  mkdirSync(consumerRoot, { recursive: true })
  writeFileSync(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify({ name, private: true, type: 'module', version: '0.0.0' }, null, 2)}\n`,
  )
  return consumerRoot
}

export function installPackage(packagePath: string, consumerRoot: string): void {
  const installed = spawnSync(
    getNpmExecutable(),
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--registry',
      NPM_REGISTRY,
      packagePath,
    ],
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: createIsolatedNpmEnvironment(consumerRoot),
    },
  )
  expectCommandSucceeded(installed, 'registry package install')
}

export function installTypeScriptTooling(consumerRoot: string): string {
  const typescript = readJsonObject(join(repositoryRoot, 'node_modules', 'typescript', 'package.json'))
  const nodeTypes = readJsonObject(join(repositoryRoot, 'node_modules', '@types', 'node', 'package.json'))
  if (typeof typescript.version !== 'string' || typeof nodeTypes.version !== 'string') {
    throw new Error('Local TypeScript tooling has no version')
  }
  const installed = spawnSync(
    getNpmExecutable(),
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--save-dev',
      '--registry',
      NPM_REGISTRY,
      `typescript@${typescript.version}`,
      `@types/node@${nodeTypes.version}`,
    ],
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: createIsolatedNpmEnvironment(consumerRoot),
    },
  )
  expectCommandSucceeded(installed, 'registry TypeScript tooling install')
  return join(consumerRoot, 'node_modules', 'typescript', 'bin', 'tsc')
}

export function createWrapperFixture(): { readonly root: string; readonly executable: string } {
  const root = mkdtempSync(join(tmpdir(), 'codex-litellm-wrapper-test-'))
  const executable = join(root, 'packages', 'codex-litellm', 'bin', 'codex-litellm.mjs')
  const coreRoot = join(root, 'packages', 'codex-litellm', 'node_modules', '@happycastle114', 'opencode-litellm')
  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(coreRoot, { recursive: true })
  copyFileSync(wrapperEntrypoint, executable)
  writeFileSync(join(coreRoot, 'package.json'), `${JSON.stringify({ name: '@happycastle114/opencode-litellm', version: '0.6.0', type: 'module', exports: { './cli': './fake-cli.mjs' } })}\n`)
  writeFileSync(join(coreRoot, 'fake-cli.mjs'), "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n")
  return { root, executable }
}

export function cleanupFixture(root: string): void {
  rmSync(root, { recursive: true, force: true })
}

export function expectCommandSucceeded(
  result: Readonly<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }>,
  operation: string,
): void {
  if (result.status !== 0) throw new Error(`${operation} failed (${String(result.status)}): ${result.stdout}${result.stderr}`)
}

function resolveExecutableFromPath(name: string): string {
  const pathValue = process.env.PATH ?? ''
  for (const entry of pathValue.split(delimiter)) {
    const candidate = resolve(entry || '.', name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`Unable to resolve ${name} from PATH=${pathValue}`)
}

export const NPM_REGISTRY = 'https://registry.npmjs.org'

export function createIsolatedNpmEnvironment(consumerRoot: string): Record<string, string> {
  const stateRoot = join(dirname(consumerRoot), 'npm-state')
  const cacheRoot = join(stateRoot, 'cache')
  const tempRoot = join(stateRoot, 'tmp')
  const userConfig = join(stateRoot, 'npmrc')
  mkdirSync(cacheRoot, { recursive: true })
  mkdirSync(tempRoot, { recursive: true })
  if (!existsSync(userConfig)) writeFileSync(userConfig, `registry=${NPM_REGISTRY}\n`)
  return {
    PATH: process.env.PATH ?? '',
    HOME: stateRoot,
    TMPDIR: tempRoot,
    npm_config_cache: cacheRoot,
    npm_config_userconfig: userConfig,
    npm_config_registry: NPM_REGISTRY,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  }
}
