import { describe, expect, test } from 'bun:test'
import {
  parsePackageSpec,
  readRegistryMetadata,
  validateMetadata,
  verifyPackageRecord,
  verifyRegistryMetadata,
} from '../scripts/verify-npm-release-metadata.mjs'

const GIT_HEAD = 'a'.repeat(40)
const PACKAGE_SPEC = '@happycastle114/opencode-litellm@0.6.0'
const PROVENANCE_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1'
const TRUSTED_PUBLISHER_ID = 'github'
const EXPECTED_INTEGRITY = 'sha512-package-integrity'

function validMetadata(overrides: Record<string, unknown> = {}) {
  return {
    version: '0.6.0',
    _npmUser: { trustedPublisher: { id: TRUSTED_PUBLISHER_ID } },
    dist: {
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      attestations: { provenance: { predicateType: PROVENANCE_PREDICATE_TYPE } },
    },
    ...overrides,
  }
}

describe('npm release metadata verifier', () => {
  test('parses scoped and unscoped exact package specs', () => {
    expect(parsePackageSpec(PACKAGE_SPEC)).toEqual({
      name: '@happycastle114/opencode-litellm',
      version: '0.6.0',
      spec: PACKAGE_SPEC,
    })
    expect(parsePackageSpec('codex-litellm@0.6.0')).toEqual({
      name: 'codex-litellm',
      version: '0.6.0',
      spec: 'codex-litellm@0.6.0',
    })
    expect(() => parsePackageSpec('codex-litellm')).toThrow()
  })

  test('accepts every required trusted-publishing and provenance field', () => {
    expect(validateMetadata(validMetadata(), {
      version: '0.6.0',
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
    })).toEqual({
      ok: true,
      failures: [],
      gitHead: GIT_HEAD,
    })
  })

  test('rejects a version, identity, publisher, integrity, or provenance mismatch', () => {
    const cases = [
      ['version', validMetadata({ version: '0.6.1' }), 'version=0.6.1'],
      ['gitHead', validMetadata({ dist: { ...validMetadata().dist, gitHead: 'b'.repeat(40) } }), `gitHead=${'b'.repeat(40)}`],
      ['trusted publisher', validMetadata({ _npmUser: { trustedPublisher: { id: 'token' } } }), 'trustedPublisher=token'],
      ['integrity', validMetadata({ dist: { ...validMetadata().dist, integrity: '' } }), 'dist.integrity'],
      ['provenance', validMetadata({ dist: { ...validMetadata().dist, attestations: { provenance: { predicateType: 'other' } } } }), 'predicateType=other'],
    ] as const
    for (const [name, metadata, failure] of cases) {
      const result = validateMetadata(metadata, { version: '0.6.0', gitHead: GIT_HEAD })
      expect(result.ok, name).toBe(false)
      expect(result.failures).toContain(failure)
    }
  })

  test('allows a missing pre-existing package but rejects invalid existing metadata', () => {
    let calls = 0
    const missing = readRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      retryMissing: false,
      delayMs: 0,
      run: () => {
        calls += 1
        return { status: 1, stdout: '', stderr: 'npm error code E404' }
      },
    })
    expect(missing).toEqual({ status: 'missing', attempts: 1 })
    expect(calls).toBe(1)

    expect(() => verifyRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      allowMissing: true,
      delayMs: 0,
      run: () => ({ status: 0, stdout: JSON.stringify(validMetadata({ version: '0.5.0' })), stderr: '' }),
    })).toThrow(/version=0\.5\.0/)
  })

  test('accepts npm 12 array-shaped package-name output and rejects a wrong name', () => {
    const found = verifyPackageRecord({
      packageName: 'codex-litellm',
      run: () => ({ status: 0, stdout: JSON.stringify(['codex-litellm']), stderr: '' }),
    })
    expect(found).toEqual({ status: 'found', attempts: 1 })

    expect(() => verifyPackageRecord({
      packageName: 'codex-litellm',
      run: () => ({ status: 0, stdout: JSON.stringify(['other-package']), stderr: '' }),
    })).toThrow(/Registry returned other-package/)
  })

  test('distinguishes an existing package record from a bootstrap-required 404', () => {
    const found = verifyPackageRecord({
      packageName: 'codex-litellm',
      delayMs: 0,
      run: () => ({ status: 0, stdout: JSON.stringify({ name: 'codex-litellm', version: '0.5.0' }), stderr: '' }),
    })
    expect(found).toEqual({ status: 'found', attempts: 1 })

    const missing = verifyPackageRecord({
      packageName: 'codex-litellm',
      delayMs: 0,
      run: () => ({ status: 1, stdout: '', stderr: 'npm error code E404' }),
    })
    expect(missing).toEqual({ status: 'missing', attempts: 1 })
  })

  test('retries bounded registry visibility failures until valid metadata appears', () => {
    const responses = [
      { status: 1, stdout: '', stderr: 'npm error code E404' },
      { status: 0, stdout: JSON.stringify(validMetadata()), stderr: '' },
    ]
    let calls = 0
    const result = verifyRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      attempts: 2,
      delayMs: 0,
      run: () => responses[calls++] ?? responses[1],
    })
    expect(result.status).toBe('valid')
    expect(result.attempts).toBe(2)
    expect(calls).toBe(2)
  })

  test('treats invalid existing metadata as terminal', () => {
    let calls = 0
    expect(() => verifyRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      attempts: 2,
      delayMs: 0,
      run: () => {
        calls += 1
        return calls === 1
          ? { status: 0, stdout: JSON.stringify(validMetadata({ dist: { ...validMetadata().dist, integrity: 'sha512-other' } })), stderr: '' }
          : { status: 0, stdout: JSON.stringify(validMetadata()), stderr: '' }
      },
    })).toThrow(/integrity=sha512-other/)
    expect(calls).toBe(1)
  })
})
