#!/usr/bin/env node

import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const nodeModules = join(repositoryRoot, 'node_modules')
const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const pinnedBunVersion = packageManifest.devDependencies?.bun
if (typeof pinnedBunVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(pinnedBunVersion)) {
  throw new Error('devDependencies.bun must be an exact semantic version')
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

function runNodeScript(path, args = []) {
  run(process.execPath, [path, ...args])
}

function runPinnedBun(args) {
  const bunManifestPath = join(nodeModules, 'bun', 'package.json')
  const bunManifest = JSON.parse(readFileSync(bunManifestPath, 'utf8'))
  if (bunManifest.version !== pinnedBunVersion) {
    throw new Error(`Expected local Bun package ${pinnedBunVersion}, got ${String(bunManifest.version)}`)
  }
  const bun = join(nodeModules, 'bun', 'bin', 'bun.exe')
  if (!existsSync(bun)) throw new Error(`Missing local Bun binary at ${bun}`)
  const version = spawnSync(bun, ['--version'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (version.error !== undefined) throw version.error
  if (version.status !== 0 || version.stdout.trim() !== pinnedBunVersion) {
    throw new Error(
      `Expected local Bun ${pinnedBunVersion}, got ${version.stdout.trim() || `exit ${String(version.status)}`}`,
    )
  }
  run(bun, args)
}

runNodeScript(join(repositoryRoot, 'scripts', 'clean-dist.mjs'))
runNodeScript(join(nodeModules, 'typescript', 'bin', 'tsc'), ['--noEmit'])
runNodeScript(join(nodeModules, 'typescript', 'bin', 'tsc'), ['--emitDeclarationOnly', '--outDir', 'dist'])
runNodeScript(join(repositoryRoot, 'scripts', 'normalize-declaration-specifiers.mjs'))
runPinnedBun([
  'build',
  'src/index.ts',
  '--target=node',
  '--format=esm',
  '--packages=external',
  '--outfile=dist/index.mjs',
])
runPinnedBun([
  'build',
  'src/cli.mts',
  '--target=node',
  '--format=esm',
  '--packages=external',
  '--outfile=dist/opencode-litellm.mjs',
])

if (process.platform !== 'win32') {
  const cliPath = join(repositoryRoot, 'dist', 'opencode-litellm.mjs')
  chmodSync(cliPath, statSync(cliPath).mode | 0o111)
}
