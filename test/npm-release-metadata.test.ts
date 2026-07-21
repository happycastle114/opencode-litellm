import { describe, expect, test } from 'bun:test'
import {
  GITHUB_PACKAGES_REGISTRY,
  parsePackageSpec,
  readRegistryMetadata,
  validateMetadata,
  verifyRegistryMetadata,
} from '../scripts/verify-npm-release-metadata.mjs'

const GIT_HEAD = 'a'.repeat(40)
const PACKAGE_SPEC = '@happycastle114/opencode-litellm@0.7.0'
const PACKAGE_NAME = '@happycastle114/opencode-litellm'
const EXPECTED_INTEGRITY = 'sha512-package-integrity'
const EXPECTED_TARBALL = `${GITHUB_PACKAGES_REGISTRY}/download/@happycastle114/opencode-litellm/0.7.0/release.tgz`

function validMetadata(overrides: Record<string, unknown> = {}) {
  return {
    name: PACKAGE_NAME,
    version: '0.7.0',
    gitHead: GIT_HEAD,
    dist: {
      tarball: EXPECTED_TARBALL,
      integrity: EXPECTED_INTEGRITY,
    },
    ...overrides,
  }
}

describe('GitHub Packages release metadata verifier', () => {
  test('parses scoped exact package specs', () => {
    expect(parsePackageSpec(PACKAGE_SPEC)).toEqual({
      name: PACKAGE_NAME,
      version: '0.7.0',
      spec: PACKAGE_SPEC,
    })
    expect(parsePackageSpec('@happycastle114/codex-litellm@0.7.0')).toEqual({
      name: '@happycastle114/codex-litellm',
      version: '0.7.0',
      spec: '@happycastle114/codex-litellm@0.7.0',
    })
    expect(() => parsePackageSpec('@happycastle114/opencode-litellm')).toThrow()
  })

  test('accepts GitHub Packages metadata without npmjs-only provenance fields', () => {
    const result = validateMetadata(validMetadata(), {
      name: PACKAGE_NAME,
      version: '0.7.0',
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      registry: GITHUB_PACKAGES_REGISTRY,
    })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.gitHead).toBe(GIT_HEAD)
    expect(result.tarball).toBe(EXPECTED_TARBALL)
  })

  test('rejects a package name, version, gitHead, integrity, or tarball mismatch', () => {
    const base = validMetadata()
    const cases = [
      ['name', { ...base, name: '@happycastle114/other' }, 'name=@happycastle114/other'],
      ['version', { ...base, version: '0.7.1' }, 'version=0.7.1'],
      ['gitHead', { ...base, gitHead: 'b'.repeat(40) }, `gitHead=${'b'.repeat(40)}`],
      ['integrity', { ...base, dist: { ...base.dist, integrity: 'sha512-other' } }, 'integrity=sha512-other'],
      ['tarball', { ...base, dist: { ...base.dist, tarball: 'https://registry.npmjs.org/other.tgz' } }, 'tarball=https://registry.npmjs.org/other.tgz'],
    ] as const
    for (const [name, metadata, failure] of cases) {
      const result = validateMetadata(metadata, {
        name: PACKAGE_NAME,
        version: '0.7.0',
        gitHead: GIT_HEAD,
        integrity: EXPECTED_INTEGRITY,
        registry: GITHUB_PACKAGES_REGISTRY,
      })
      expect(result.ok, name).toBe(false)
      expect(result.failures).toContain(failure)
    }
  })

  test('allows a missing exact version during preflight but rejects invalid existing metadata', () => {
    let calls = 0
    const missing = readRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      registry: GITHUB_PACKAGES_REGISTRY,
      retryMissing: false,
      delayMs: 0,
      run: (_spec, options) => {
        calls += 1
        expect(options.registry).toBe(GITHUB_PACKAGES_REGISTRY)
        return { status: 1, stdout: '', stderr: 'npm error code E404' }
      },
    })
    expect(missing).toEqual({ status: 'missing', attempts: 1 })
    expect(calls).toBe(1)

    expect(() => verifyRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      registry: GITHUB_PACKAGES_REGISTRY,
      gitHead: GIT_HEAD,
      integrity: EXPECTED_INTEGRITY,
      allowMissing: true,
      delayMs: 0,
      run: () => ({ status: 0, stdout: JSON.stringify(validMetadata({ version: '0.5.0' })), stderr: '' }),
    })).toThrow(/version=0\.5\.0/)
  })

  test('retries bounded registry visibility failures until valid metadata appears', () => {
    const responses = [
      { status: 1, stdout: '', stderr: 'npm error code E404' },
      { status: 0, stdout: JSON.stringify(validMetadata()), stderr: '' },
    ]
    let calls = 0
    const result = verifyRegistryMetadata({
      packageSpec: PACKAGE_SPEC,
      registry: GITHUB_PACKAGES_REGISTRY,
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
      registry: GITHUB_PACKAGES_REGISTRY,
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
