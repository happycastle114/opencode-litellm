import { spawnSync } from 'node:child_process'

export const PROVENANCE_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1'
export const TRUSTED_PUBLISHER_ID = 'github'
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

export function verifyPackageRecord({ packageName, ...options } = {}) {
  if (typeof packageName !== 'string' || packageName.length === 0 || packageName.endsWith('@')) {
    throw new Error('A package name is required.')
  }
  const result = (options.run ?? runNpmView)(packageName, {
    npmExecutable: options.npmExecutable ?? 'npm',
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fields: ['name'],
  })
  if (result.status !== 0) {
    if (isNotFound(result)) return Object.freeze({ status: 'missing', attempts: 1 })
    throw new Error(`Unable to read package record ${packageName}: ${formatCommandFailure(result)}`)
  }
  const payload = JSON.parse(result.stdout)
  const actualName =
    typeof payload === 'string'
      ? payload
      : Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'string'
        ? payload[0]
        : parseMetadata(payload).name
  if (actualName !== undefined && actualName !== packageName) {
    throw new Error(`Registry returned ${String(actualName)} for ${packageName}`)
  }
  return Object.freeze({ status: 'found', attempts: result.attempts ?? 1 })
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
  const gitHead = parsed.dist?.gitHead ?? parsed.gitHead
  const trustedPublisher = parsed._npmUser?.trustedPublisher?.id
  const integrity = parsed.dist?.integrity
  const predicateType = parsed.dist?.attestations?.provenance?.predicateType
  const failures = []

  if (parsed.version !== expected.version) failures.push(`version=${String(parsed.version)}`)
  if (gitHead !== expected.gitHead) failures.push(`gitHead=${String(gitHead)}`)
  if (trustedPublisher !== TRUSTED_PUBLISHER_ID) {
    failures.push(`trustedPublisher=${String(trustedPublisher)}`)
  }
  if (typeof integrity !== 'string' || integrity.trim() === '') failures.push('dist.integrity')
  if (expected.integrity !== undefined && integrity !== expected.integrity) {
    failures.push(`integrity=${String(integrity)}`)
  }
  if (predicateType !== PROVENANCE_PREDICATE_TYPE) {
    failures.push(`predicateType=${String(predicateType)}`)
  }

  return Object.freeze({ ok: failures.length === 0, failures, gitHead })
}

export function isNotFound(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  return /(?:npm\s+error\s+code\s+E404|\bE404\b)/i.test(text)
}

export function readRegistryMetadata({
  packageSpec,
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
    const result = run(exact.spec, { npmExecutable, timeoutMs: boundedTimeout })
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

export function verifyRegistryMetadata({ packageSpec, gitHead, ...options } = {}) {
  const expected = { ...parsePackageSpec(packageSpec), gitHead, integrity: options.integrity }
  if (typeof gitHead !== 'string' || gitHead.length === 0) throw new Error('A release gitHead is required.')
  const result = readRegistryMetadata({ packageSpec, ...options })
  if (result.status === 'missing') {
    if (options.allowMissing === true) return result
    throw new Error(`${packageSpec} is not present in the npm registry.`)
  }
  const validation = validateMetadata(result.metadata, expected)
  if (!validation.ok) {
    throw new Error(`${packageSpec} metadata failed validation: ${validation.failures.join(', ')}`)
  }
  return Object.freeze({ status: 'valid', attempts: result.attempts, validation })
}

function runNpmView(packageSpec, { npmExecutable = 'npm', timeoutMs, fields = [] }) {
  const result = spawnSync(npmExecutable, ['view', packageSpec, ...fields, '--json'], {
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function parseArguments(argv) {
  const [mode, ...rest] = argv
  if (mode !== 'preflight' && mode !== 'readback' && mode !== 'record') {
    throw new Error('Usage: verify-npm-release-metadata.mjs <record|preflight|readback> --package <name[@version]>')
  }
  const args = { mode }
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const name = key.slice(2).replaceAll('-', '_')
    if (name === 'allow_missing') {
      args.allowMissing = true
      continue
    }
    const value = rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    args[name] = value
  }
  if (typeof args.package !== 'string') throw new Error('The --package argument is required.')
  if (mode !== 'record' && typeof args.git_head !== 'string') {
    throw new Error('The --git-head argument is required for metadata verification.')
  }
  return args
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArguments(process.argv.slice(2))
    if (args.mode === 'record') {
      const result = verifyPackageRecord({ packageName: args.package })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      process.exit(0)
    }
    const result = verifyRegistryMetadata({
      packageSpec: args.package,
      gitHead: args.git_head,
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
