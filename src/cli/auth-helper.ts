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
import { nativeLiteOrigin } from './native-lite'

const AUTH_HELPER = {
  directory: ['.codex', 'libexec'] as const,
  fileName: 'litellm-auth-token.mjs',
} as const

export const CODEX_AUTH_HELPER_MODE = 0o700
const DIRECTORY_MODE = 0o700
const IS_WINDOWS = process.platform === 'win32'

export const CODEX_AUTH_HELPER_FILE_NAME = AUTH_HELPER.fileName

export type CodexAuthHelperInstallOptions = {
  readonly homeDirectory: string
  readonly gatewayOrigin: string
  readonly apiKeyFilePath: string
  readonly now?: () => Date
}

export type CodexAuthHelperInstallResult = {
  readonly status: 'installed' | 'unchanged'
  readonly destination: string
}

export function resolveCodexAuthHelperPath(homeDirectory: string): string {
  return join(homeDirectory, ...AUTH_HELPER.directory, AUTH_HELPER.fileName)
}

export const codexAuthHelperPath = resolveCodexAuthHelperPath

export function normalizeCodexAuthGatewayOrigin(gatewayOrigin: string): string {
  return nativeLiteOrigin(gatewayOrigin).replace(/\/v1$/, '')
}

export function renderCodexAuthHelperSource(
  gatewayOrigin: string,
  apiKeyFilePath: string,
): string {
  const origin = normalizeCodexAuthGatewayOrigin(gatewayOrigin)
  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const CONFIG = {
  expectedBaseURL: ${JSON.stringify(origin)},
  apiKeyFilePath: ${JSON.stringify(apiKeyFilePath)},
  apiKeyControlPattern: /[\\u0000-\\u001f\\u007f]/,
}

function fail(message) {
  process.stderr.write(message + '\\n')
  process.exitCode = 1
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function main() {
  if (process.argv.length !== 2) {
    fail('Unsupported Codex auth helper arguments.')
    return
  }
  const token = JSON.parse(readFileSync(CONFIG.apiKeyFilePath, 'utf8'))
  if (!isRecord(token) || token.base_url !== CONFIG.expectedBaseURL) {
    fail('The installed API key is missing or belongs to a different gateway.')
    return
  }
  const key = token.key
  if (typeof key !== 'string' || key.trim() === '' || CONFIG.apiKeyControlPattern.test(key)) {
    fail('The installed API key is not usable. Run installation and enter the API key again.')
    return
  }
  process.stdout.write(key + '\\n')
}

try {
  main()
} catch {
  fail('No installed API key is available. Run installation and enter the API key again.')
}
`
}

export const codexAuthHelperSource = renderCodexAuthHelperSource

export function installCodexAuthHelper(
  options: CodexAuthHelperInstallOptions,
): CodexAuthHelperInstallResult {
  const destination = resolveCodexAuthHelperPath(options.homeDirectory)
  const source = renderCodexAuthHelperSource(options.gatewayOrigin, options.apiKeyFilePath)
  mkdirSync(dirname(destination), {
    recursive: true,
    ...(IS_WINDOWS ? {} : { mode: DIRECTORY_MODE }),
  })

  if (existsSync(destination) && readFileSync(destination, 'utf8') === source) {
    if (!IS_WINDOWS) chmodSync(destination, CODEX_AUTH_HELPER_MODE)
    return { status: 'unchanged', destination }
  }

  const temporary = temporaryPath(destination, options.now)
  try {
    writeFileSync(temporary, source, {
      encoding: 'utf8',
      ...(IS_WINDOWS ? {} : { mode: CODEX_AUTH_HELPER_MODE }),
    })
    renameSync(temporary, destination)
    if (!IS_WINDOWS) chmodSync(destination, CODEX_AUTH_HELPER_MODE)
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
