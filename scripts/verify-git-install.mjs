#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencode-litellm-git-install-'))
const homeRoot = join(fixtureRoot, 'home')

const TOOLKIT_HELP_SIGNATURE = [
  'Usage: opencode-litellm <command> [options]',
  '',
  'Commands:',
  '  install  Configure supported clients for LiteLLM',
  '  doctor   Check the local LiteLLM integration',
  '  login    Sign in with the built-in LiteLLM SSO onboarding flow',
  '  logout   Remove the local LiteLLM SSO session',
  '  whoami   Show safe local LiteLLM SSO session metadata',
  '  claude   Launch Claude Code with OAuth-safe LiteLLM routing',
  '  codex    Launch Codex with the installed LiteLLM profile',
  '  opencode Launch OpenCode with the installed LiteLLM toolkit',
].join('\n')
const ALLOWED_ENVIRONMENT_NAMES = new Set([
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CI',
  'GITHUB_ACTIONS',
  'RUNNER_OS',
  'RUNNER_TEMP',
  'TERM',
  'NO_COLOR',
])
const PROXY_ENVIRONMENT_NAMES = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
])
const REPRESENTATIVE_SECRET_ENVIRONMENT_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'LITELLM_PROXY_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AZURE_API_KEY',
  'DATABASE_PASSWORD',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)}):\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return result.stdout.trim()
}

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath
  const npmNodeExecPath = process.env.npm_node_execpath ?? process.execPath
  if (npmExecPath === undefined || npmExecPath === '') return run('npm', args, options)
  return run(npmNodeExecPath, [npmExecPath, ...args], options)
}

function copySourceFixture() {
  cpSync(repositoryRoot, fixtureRoot, {
    recursive: true,
    filter(source) {
      const path = relative(repositoryRoot, source)
      if (path === '') return true
      const topLevel = path.split(sep)[0]
      return topLevel !== '.git'
        && topLevel !== '.omo'
        && topLevel !== '.npmrc'
        && topLevel !== 'dist'
        && topLevel !== 'node_modules'
        && topLevel !== '.env'
        && !topLevel.startsWith('.env.')
    },
  })
  if (existsSync(join(fixtureRoot, 'dist'))) throw new Error('Git fixture unexpectedly contains dist/')
}

function createGitRevision() {
  run('git', ['init', '--quiet', '--initial-branch=main'], { cwd: fixtureRoot })
  run('git', ['config', 'user.name', 'Git install test'], { cwd: fixtureRoot })
  run('git', ['config', 'user.email', 'git-install-test@example.invalid'], { cwd: fixtureRoot })
  run('git', ['add', '--all'], { cwd: fixtureRoot })
  run('git', ['commit', '--quiet', '--no-gpg-sign', '-m', 'git install fixture'], { cwd: fixtureRoot })
  return run('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot })
}

function createConsumer(root, stateRoot) {
  const cacheRoot = join(stateRoot, 'cache')
  const tempRoot = join(stateRoot, 'tmp')
  const userConfig = join(stateRoot, 'npmrc')
  const globalConfig = join(stateRoot, 'global-npmrc')
  mkdirSync(root, { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })
  mkdirSync(tempRoot, { recursive: true })
  mkdirSync(homeRoot, { recursive: true })
  writeFileSync(userConfig, 'registry=https://registry.npmjs.org\n')
  writeFileSync(globalConfig, '')
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'opencode-litellm-git-install-consumer', private: true, version: '0.0.0' }, null, 2)}\n`,
  )
  return { cacheRoot, tempRoot, userConfig, globalConfig }
}

function isolatedEnvironment(state, source = process.env) {
  const env = {}
  for (const name of ALLOWED_ENVIRONMENT_NAMES) {
    const value = source[name]
    if (typeof value !== 'string') continue
    if (PROXY_ENVIRONMENT_NAMES.has(name)) {
      const sanitized = sanitizeProxyValue(value)
      if (sanitized !== undefined) env[name] = sanitized
      continue
    }
    env[name] = value
  }
  const sourcePath = source.PATH ?? source.Path ?? ''
  env.PATH = sourcePath
    .split(delimiter)
    .filter((entry) => !existsSync(join(entry, 'bun')) && !existsSync(join(entry, 'bun.exe')))
    .join(delimiter)
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return {
    ...env,
    HOME: homeRoot,
    USERPROFILE: homeRoot,
    APPDATA: join(homeRoot, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(homeRoot, 'AppData', 'Local'),
    TEMP: state.tempRoot,
    TMP: state.tempRoot,
    TMPDIR: state.tempRoot,
    npm_config_cache: state.cacheRoot,
    npm_config_globalconfig: state.globalConfig,
    NPM_CONFIG_CACHE: state.cacheRoot,
    npm_config_userconfig: state.userConfig,
    NPM_CONFIG_GLOBALCONFIG: state.globalConfig,
    npm_config_registry: 'https://registry.npmjs.org',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_USERCONFIG: state.userConfig,
  }
}

function sanitizeProxyValue(value) {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') return undefined
    return value
  } catch {
    return undefined
  }
}

function assertCredentialIsolation(state) {
  const syntheticSource = { ...process.env }
  for (const name of REPRESENTATIVE_SECRET_ENVIRONMENT_NAMES) {
    syntheticSource[name] = `synthetic-${name}`
  }
  syntheticSource.HTTPS_PROXY = 'https://synthetic-user:synthetic-pass@proxy.invalid:8443'
  const env = isolatedEnvironment(state, syntheticSource)
  const leaked = REPRESENTATIVE_SECRET_ENVIRONMENT_NAMES.filter((name) => env[name] !== undefined)
  if (leaked.length !== 0) throw new Error(`Credential-shaped environment leaked: ${leaked.join(', ')}`)
  if (env.HTTPS_PROXY !== undefined) throw new Error('Credential-bearing HTTPS_PROXY was forwarded')
  return { representativeSecretsAbsent: true }
}

function assertNpmGlobalConfigIsolation(state) {
  if (readFileSync(state.globalConfig, 'utf8') !== '') {
    throw new Error(`Expected an empty isolated npm globalconfig: ${state.globalConfig}`)
  }
  const env = isolatedEnvironment(state)
  const effective = runNpm(['config', 'get', 'globalconfig'], {
    cwd: fixtureRoot,
    env,
  })
  if (resolve(effective) !== resolve(state.globalConfig)) {
    throw new Error(`npm globalconfig escaped isolation: ${effective}`)
  }
  return { emptyGlobalConfig: true, effectivePathIsolated: true }
}

function assertGlobalBunIsUnavailable(env) {
  const result = spawnSync('bun', ['--version'], { env, stdio: 'ignore' })
  if (result.status === 0) throw new Error('Git install fixture still sees a global Bun binary')
}

function assertEmptyDirectory(path, context) {
  const entries = readdirSync(path)
  if (entries.length !== 0) throw new Error(`${context} was not empty before npx: ${entries.join(', ')}`)
}

function assertToolkitHelp(result, context) {
  const normalized = result.replaceAll('\r\n', '\n')
  if (!normalized.startsWith(`${TOOLKIT_HELP_SIGNATURE}\n`)) {
    throw new Error(`${context} did not expose the opencode-litellm toolkit help signature:\n${result}`)
  }
}

function resolveNpxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function resolveInstalledBin(root, name) {
  const binRoot = join(root, 'node_modules', '.bin')
  const candidates = process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name]
  for (const candidate of candidates) {
    const path = join(binRoot, candidate)
    if (existsSync(path)) return path
  }
  throw new Error(`Git install did not create ${name} under ${binRoot}`)
}

function assertInstalledBin(root, name, state) {
  const binary = resolveInstalledBin(root, name)
  const result = run(binary, ['--help'], {
    cwd: root,
    env: isolatedEnvironment(state),
    shell: process.platform === 'win32',
  })
  assertToolkitHelp(result, `${name} installed bin`)
}

function assertNpxBin(spec, name, root, state) {
  const result = run(resolveNpxCommand(), ['--yes', '--package', spec, name, '--help'], {
    cwd: root,
    env: isolatedEnvironment(state),
    shell: process.platform === 'win32',
  })
  assertToolkitHelp(result, `npx ${name}`)
}

try {
  copySourceFixture()
  const sha = createGitRevision()
  const spec = `git+${pathToFileURL(fixtureRoot).href}#${sha}`
  const isolationState = {
    cacheRoot: join(fixtureRoot, 'isolation-cache'),
    tempRoot: join(fixtureRoot, 'isolation-tmp'),
    userConfig: join(fixtureRoot, 'isolation-npmrc'),
    globalConfig: join(fixtureRoot, 'isolation-global-npmrc'),
  }
  writeFileSync(isolationState.globalConfig, '')
  const credentialIsolation = assertCredentialIsolation(isolationState)
  const npmGlobalConfigIsolation = assertNpmGlobalConfigIsolation(isolationState)
  const npxEvidence = []
  for (const name of ['opencode-litellm', 'codex-litellm']) {
    const npxRoot = join(fixtureRoot, `npx-${name}`)
    const npxState = createConsumer(npxRoot, join(fixtureRoot, `npx-state-${name}`))
    const npxEnv = isolatedEnvironment(npxState)
    assertEmptyDirectory(npxState.cacheRoot, `${name} npm cache`)
    assertGlobalBunIsUnavailable(npxEnv)
    assertNpxBin(spec, name, npxRoot, npxState)
    npxEvidence.push({ name, emptyCacheBeforeInstall: true })
  }

  const consumerRoot = join(fixtureRoot, 'consumer')
  const npmStateRoot = join(fixtureRoot, 'npm-state')
  const state = createConsumer(consumerRoot, npmStateRoot)
  const env = isolatedEnvironment(state)
  assertGlobalBunIsUnavailable(env)
  runNpm([
    'install',
    '--foreground-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--save-exact',
    spec,
  ], {
    cwd: consumerRoot,
    env,
  })

  const coreRoot = join(consumerRoot, 'node_modules', '@happycastle114', 'opencode-litellm')
  const distCli = join(coreRoot, 'dist', 'opencode-litellm.mjs')
  if (!existsSync(distCli)) throw new Error(`Git install did not run prepare/build: ${distCli}`)
  assertInstalledBin(consumerRoot, 'opencode-litellm', state)
  assertInstalledBin(consumerRoot, 'codex-litellm', state)

  const manifest = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8'))
  process.stdout.write(`${JSON.stringify({
    spec,
    revision: sha,
    package: manifest.name,
    version: manifest.version,
    distCli,
    bins: ['opencode-litellm', 'codex-litellm'],
    credentialIsolation,
    npmGlobalConfigIsolation,
    npx: npxEvidence,
  })}\n`)
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
