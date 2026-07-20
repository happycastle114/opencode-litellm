import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const AUTH_HELPER = {
  directory: ['.codex', 'libexec'] as const,
  fileName: 'litellm-auth-token.mjs',
  tokenDirectory: '.litellm',
  tokenFileName: 'token.json',
  launchctlFlag: '--launchctl-setenv',
  launchctlPath: '/bin/launchctl',
  launchctlCommand: 'setenv',
} as const

const FIELD = {
  baseURL: 'base_url',
  key: 'key',
} as const

const FILE_MODE = 0o700
const DIRECTORY_MODE = 0o700
const IS_WINDOWS = process.platform === 'win32'
const ENV_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$'

export const CODEX_AUTH_HELPER_FILE_NAME = AUTH_HELPER.fileName

export type CodexAuthHelperInstallOptions = {
  readonly homeDirectory: string
  readonly gatewayOrigin: string
  readonly now?: () => Date
}

export type CodexAuthHelperInstallResult = {
  readonly status: 'installed' | 'unchanged'
  readonly destination: string
}

/**
 * Resolve the path managed by the Codex command-backed authentication provider.
 * Keeping this as a pure seam makes callers and tests independent of process HOME.
 */
export function resolveCodexAuthHelperPath(homeDirectory: string): string {
  return join(homeDirectory, ...AUTH_HELPER.directory, AUTH_HELPER.fileName)
}

export const codexAuthHelperPath = resolveCodexAuthHelperPath

/**
 * Normalize the public gateway origin that is safe to embed in the helper.
 * The CLI treats `/v1` as the API suffix rather than part of the origin.
 */
export function normalizeCodexAuthGatewayOrigin(gatewayOrigin: string): string {
  let url: URL
  try {
    url = new URL(gatewayOrigin)
  } catch {
    throw new Error('The LiteLLM gateway origin must be an absolute http(s) URL.')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('The LiteLLM gateway origin must not contain credentials, query, or fragment data.')
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  const normalized = `${url.protocol}//${url.host}${path}`
  if (normalized === '') throw new Error('A non-empty LiteLLM gateway origin is required.')
  return normalized
}

/**
 * Render the complete standalone Node ESM helper without embedding a credential.
 */
export function renderCodexAuthHelperSource(gatewayOrigin: string): string {
  const origin = normalizeCodexAuthGatewayOrigin(gatewayOrigin)
  const embeddedOrigin = JSON.stringify(origin)
  const tokenDirectory = JSON.stringify(AUTH_HELPER.tokenDirectory)
  const tokenFileName = JSON.stringify(AUTH_HELPER.tokenFileName)
  const launchctlFlag = JSON.stringify(AUTH_HELPER.launchctlFlag)
  const launchctlPath = JSON.stringify(AUTH_HELPER.launchctlPath)
  const launchctlCommand = JSON.stringify(AUTH_HELPER.launchctlCommand)
  const baseURLField = JSON.stringify(FIELD.baseURL)
  const keyField = JSON.stringify(FIELD.key)

  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const CONFIG = {
  expectedBaseURL: ${embeddedOrigin},
  tokenDirectory: ${tokenDirectory},
  tokenFileName: ${tokenFileName},
  launchctlFlag: ${launchctlFlag},
  launchctlPath: ${launchctlPath},
  launchctlCommand: ${launchctlCommand},
  baseURLField: ${baseURLField},
  keyField: ${keyField},
  envNamePattern: /${ENV_NAME_PATTERN}/,
}

function fail(message) {
  process.stderr.write(message + '\\n')
  process.exitCode = 1
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readGatewayKey() {
  const home = process.env.HOME
  if (typeof home !== 'string' || home === '') {
    fail('Codex auth helper could not resolve HOME.')
    return undefined
  }

  let parsed
  try {
    const path = join(home, CONFIG.tokenDirectory, CONFIG.tokenFileName)
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail('Codex auth token is missing or malformed.')
    return undefined
  }

  if (!isRecord(parsed)) {
    fail('Codex auth token is missing or malformed.')
    return undefined
  }

  const expectedBaseURL = CONFIG.expectedBaseURL.replace(/\\/+$/, '')
  const storedBaseURL = parsed[CONFIG.baseURLField]
  const key = parsed[CONFIG.keyField]
  if (storedBaseURL !== expectedBaseURL) {
    fail('Codex auth token belongs to a different gateway.')
    return undefined
  }
  if (typeof key !== 'string' || key.length === 0) {
    fail('Codex auth token does not contain a usable key.')
    return undefined
  }
  return key
}

function main() {
  const key = readGatewayKey()
  if (key === undefined) return

  const args = process.argv.slice(2)
  if (args.length === 0) {
    process.stdout.write(key + '\\n')
    return
  }
  if (args.length !== 2 || args[0] !== CONFIG.launchctlFlag) {
    fail('Unsupported Codex auth helper arguments.')
    return
  }

  const envName = args[1]
  if (!CONFIG.envNamePattern.test(envName)) {
    fail('Invalid launchctl environment variable name.')
    return
  }
  if (process.platform !== 'darwin') {
    fail('launchctl environment export is only supported on macOS.')
    return
  }

  const result = spawnSync(
    CONFIG.launchctlPath,
    [CONFIG.launchctlCommand, envName, key],
    { stdio: 'ignore' },
  )
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    fail('Unable to export the Codex auth token with launchctl.')
  }
}

try {
  main()
} catch {
  fail('Codex auth helper failed without exposing credential details.')
}
`
}

export const codexAuthHelperSource = renderCodexAuthHelperSource

/**
 * Install the helper with a temporary file + rename so readers never observe a
 * partial source. Reinstalling identical bytes leaves the file untouched.
 */
export function installCodexAuthHelper(
  options: CodexAuthHelperInstallOptions,
): CodexAuthHelperInstallResult {
  const destination = resolveCodexAuthHelperPath(options.homeDirectory)
  const source = renderCodexAuthHelperSource(options.gatewayOrigin)
  mkdirSync(dirname(destination), {
    recursive: true,
    ...(IS_WINDOWS ? {} : { mode: DIRECTORY_MODE }),
  })

  if (existsSync(destination) && readFileSync(destination, 'utf8') === source) {
    if (!IS_WINDOWS) chmodSync(destination, FILE_MODE)
    return { status: 'unchanged', destination }
  }

  const temporary = temporaryPath(destination, options.now)
  try {
    writeFileSync(temporary, source, {
      encoding: 'utf8',
      ...(IS_WINDOWS ? {} : { mode: FILE_MODE }),
    })
    renameSync(temporary, destination)
    if (!IS_WINDOWS) chmodSync(destination, FILE_MODE)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  return { status: 'installed', destination }
}

function temporaryPath(destination: string, now: (() => Date) | undefined): string {
  const timestamp = now?.().getTime() ?? Date.now()
  const base = `${destination}.${process.pid}.${timestamp}.tmp`
  let candidate = base
  let suffix = 1
  while (existsSync(candidate)) {
    candidate = `${base}.${suffix}`
    suffix += 1
  }
  return candidate
}
