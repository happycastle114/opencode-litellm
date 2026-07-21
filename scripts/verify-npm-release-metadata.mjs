import { spawnSync } from 'node:child_process'

export const GITHUB_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'
export const DEFAULT_ATTEMPTS = 6
export const DEFAULT_DELAY_MS = 5000
export const DEFAULT_TIMEOUT_MS = 15000

const MAX_ATTEMPTS = 8
const MAX_DELAY_MS = 30000
const MAX_TIMEOUT_MS = 30000

export function parsePackageSpec(spec) {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new Error('A package spec is required.')
  }
  const separator = spec.lastIndexOf('@')
  if (separator <= 0 || separator === spec.length - 1) {
    throw new Error(`Expected an exact package spec, received: ${spec}`)
  }
  const name = spec.slice(0, separator)
  const version = spec.slice(separator + 1)
  if (!name || !version || (name.startsWith('@') && name.indexOf('/') < 2)) {
    throw new Error(`Expected an exact package spec, received: ${spec}`)
  }
  return Object.freeze({ name, version, spec })
}

export function parseMetadata(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!isRecord(parsed)) throw new Error('npm view returned a non-object payload.')
  const metadata = Array.isArray(parsed) ? parsed[0] : parsed
  if (!isRecord(metadata)) throw new Error('npm view returned an empty metadata payload.')
  return metadata
}

export function validateMetadata(metadata, expected) {
  const parsed = parseMetadata(metadata)
  const packageName = parsed.name
  const gitHead = parsed.gitHead ?? parsed.dist?.gitHead
  const integrity = parsed.dist?.integrity
  const tarball = parsed.dist?.tarball
  const failures = []

  if (expected.name !== undefined && packageName !== expected.name) {
    failures.push(`name=${String(packageName)}`)
  }
  if (parsed.version !== expected.version) failures.push(`version=${String(parsed.version)}`)
  if (expected.gitHead !== undefined && gitHead !== expected.gitHead) {
    failures.push(`gitHead=${String(gitHead)}`)
  }
  if (typeof integrity !== 'string' || integrity.trim() === '') failures.push('dist.integrity')
  if (expected.integrity !== undefined && integrity !== expected.integrity) {
    failures.push(`integrity=${String(integrity)}`)
  }
  if (typeof tarball !== 'string' || tarball.trim() === '') {
    failures.push('dist.tarball')
  } else if (expected.registry !== undefined && !isRegistryUrl(tarball, expected.registry)) {
    failures.push(`tarball=${tarball}`)
  }

  return Object.freeze({ ok: failures.length === 0, failures, gitHead, integrity, tarball })
}

export function readRegistryMetadata({
  packageSpec,
  registry = GITHUB_PACKAGES_REGISTRY,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryMissing = true,
  npmExecutable = 'npm',
  run = runNpmView,
} = {}) {
  const exact = parsePackageSpec(packageSpec)
  const boundedAttempts = boundedInteger(attempts, 1, MAX_ATTEMPTS, 'attempts')
  const boundedDelay = boundedInteger(delayMs, 0, MAX_DELAY_MS, 'delayMs')
  const boundedTimeout = boundedInteger(timeoutMs, 1, MAX_TIMEOUT_MS, 'timeoutMs')
  const errors = []

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const result = run(exact.spec, { npmExecutable, timeoutMs: boundedTimeout, registry })
    if (result.status === 0) {
      try {
        return Object.freeze({ status: 'found', metadata: parseMetadata(result.stdout), attempts: attempt })
      } catch (error) {
        errors.push(`attempt ${attempt}: ${error.message}`)
      }
    } else if (isNotFound(result)) {
      if (!retryMissing || attempt === boundedAttempts) {
        return Object.freeze({ status: 'missing', attempts: attempt })
      }
      errors.push(`attempt ${attempt}: registry returned E404`)
    } else {
      errors.push(`attempt ${attempt}: ${formatCommandFailure(result)}`)
    }

    if (attempt < boundedAttempts && boundedDelay > 0) sleep(boundedDelay)
  }

  throw new Error(`Unable to read ${exact.spec} after ${boundedAttempts} attempts: ${errors.join('; ')}`)
}

export function verifyRegistryMetadata({ packageSpec, gitHead, registry = GITHUB_PACKAGES_REGISTRY, ...options } = {}) {
  const exact = parsePackageSpec(packageSpec)
  if (typeof gitHead !== 'string' || gitHead.length === 0) throw new Error('A release gitHead is required.')
  const expected = { ...exact, gitHead, integrity: options.integrity, registry }
  const result = readRegistryMetadata({ packageSpec, registry, ...options })
  if (result.status === 'missing') {
    if (options.allowMissing === true) return result
    throw new Error(`${packageSpec} is not present in the GitHub Packages registry.`)
  }
  const validation = validateMetadata(result.metadata, expected)
  if (!validation.ok) {
    throw new Error(`${packageSpec} metadata failed validation: ${validation.failures.join(', ')}`)
  }
  return Object.freeze({ status: 'valid', attempts: result.attempts, validation })
}

export function isNotFound(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  return /(?:npm\s+error\s+code\s+E404|\bE404\b)/i.test(text)
}

function runNpmView(packageSpec, { npmExecutable = 'npm', timeoutMs, registry = GITHUB_PACKAGES_REGISTRY }) {
  const result = spawnSync(npmExecutable, ['view', packageSpec, '--json', '--registry', registry], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  return {
    status: result.status ?? 1,
    attempts: 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? `${result.stderr ?? ''}\n${result.error.message}` : result.stderr ?? '',
  }
}

function formatCommandFailure(result) {
  const detail = `${result?.stderr ?? ''}${result?.stdout ?? ''}`.trim().replace(/\s+/g, ' ')
  return detail || `exit=${String(result?.status)}`
}

function boundedInteger(value, minimum, maximum, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function isRegistryUrl(candidate, registry) {
  try {
    return new URL(candidate).origin === new URL(registry).origin
  } catch {
    return false
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function parseArguments(argv) {
  const [mode, ...rest] = argv
  if (mode !== 'preflight' && mode !== 'readback') {
    throw new Error('Usage: verify-npm-release-metadata.mjs <preflight|readback> --package <name[@version]> --git-head <sha>')
  }
  const args = { mode }
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const name = key.slice(2).replaceAll('-', '_')
    const value = rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    args[name] = value
  }
  if (typeof args.package !== 'string') throw new Error('The --package argument is required.')
  if (typeof args.git_head !== 'string') throw new Error('The --git-head argument is required.')
  return args
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArguments(process.argv.slice(2))
    const result = verifyRegistryMetadata({
      packageSpec: args.package,
      gitHead: args.git_head,
      registry: args.registry ?? GITHUB_PACKAGES_REGISTRY,
      allowMissing: args.mode === 'preflight',
      attempts: args.mode === 'preflight' ? 1 : Number(args.attempts ?? DEFAULT_ATTEMPTS),
      delayMs: args.mode === 'preflight' ? 0 : Number(args.delay_ms ?? DEFAULT_DELAY_MS),
      timeoutMs: Number(args.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      retryMissing: args.mode === 'readback',
      integrity: args.integrity,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
