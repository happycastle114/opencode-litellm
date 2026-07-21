import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InstallAuth } from '../src/cli/install-intent'
import {
  InstallPreparationError,
  InstallPreparationErrorCode,
  prepareInstall,
} from '../src/cli/install-preparation'
import { boundary, DISCOVERY, installOptions, VALUE, writeToken } from './install-preparation-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'install-preparation-credentials-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('install preparation credentials', () => {
  test('fails with a typed secret-safe error when an environment credential is missing', async () => {
    // Given: the named environment variable is absent
    const pending = prepareInstall(
      installOptions({ auth: InstallAuth.Environment, nonInteractive: true }),
      boundary(homeDirectory, { env: { UNRELATED_SECRET: VALUE.apiKey } }),
    )

    // When/Then: preparation fails before discovery without exposing any value
    await expect(pending).rejects.toBeInstanceOf(InstallPreparationError)
    await expect(pending).rejects.toMatchObject({
      code: InstallPreparationErrorCode.MissingEnvironmentCredential,
    })
    await expect(pending).rejects.not.toThrow(VALUE.apiKey)
  })

  test.each([
    ['CR', '\r'],
    ['LF', '\n'],
    ['control', '\u0000'],
  ] as const)('rejects an environment API key containing %s before discovery or writes', async (_label, control) => {
    // Given: the configured environment credential contains a header control character
    let discoveryCalls = 0
    const pending = prepareInstall(
      installOptions({ auth: InstallAuth.Environment, nonInteractive: true }),
      boundary(homeDirectory, {
        env: { HOME: homeDirectory, [VALUE.envName]: `${VALUE.apiKey}${control}` },
        discover: async () => {
          discoveryCalls += 1
          return DISCOVERY
        },
      }),
    )

    // When/Then: preparation fails before any authenticated work or token file creation
    await expect(pending).rejects.toMatchObject({
      code: InstallPreparationErrorCode.MissingEnvironmentCredential,
    })
    expect(discoveryCalls).toBe(0)
    expect(existsSync(join(homeDirectory, '.litellm', 'token.json'))).toBe(false)
  })

  test('rejects a non-interactive SSO token for another exact origin actionably', async () => {
    // Given: the official token belongs to a different gateway
    writeToken(homeDirectory, VALUE.otherOrigin)
    const pending = prepareInstall(
      installOptions({ auth: InstallAuth.Sso, nonInteractive: true }),
      boundary(homeDirectory),
    )

    // When/Then: the error identifies the remediation but never the stored key
    await expect(pending).rejects.toMatchObject({
      code: InstallPreparationErrorCode.MissingSsoCredential,
    })
    await expect(pending).rejects.toThrow(/login/i)
    await expect(pending).rejects.not.toThrow(VALUE.apiKey)
  })
})
