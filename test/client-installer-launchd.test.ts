import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { installPreparedClients } from '../src/cli/client-installer'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import {
  BUNDLED_CATALOG,
  PLATFORM,
  VALUE,
  createHomeDirectory,
  preparedInstall,
} from './client-installer-test-support'

let homeDirectory: string

beforeEach(() => {
  homeDirectory = createHomeDirectory()
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('prepared client installer', () => {
  test(
    'syncs the SSO gateway key into launchd for a Codex OAuth header',
    async () => {
      // Given: external macOS setup using SSO and the OAuth Codex mode
      const calls: Array<{ readonly file: string; readonly args: readonly string[] }> = []
      const configPath = join(homeDirectory, '.codex', 'config.toml')

      // When: the prepared client is installed through the injected process boundary
      const result = await installPreparedClients(preparedInstall({
        target: InstallTarget.Codex,
        auth: InstallAuth.Sso,
        codexConfig: configPath,
        codexMode: CodexMode.OAuth,
      }), {
        env: { HOME: homeDirectory },
        now: () => new Date(0),
        externalSetup: true,
        platform: PLATFORM.Darwin,
        bundledCodexCatalog: () => BUNDLED_CATALOG,
        codexSpawnBoundary: {
          spawn: (file, args) => {
            calls.push({ file, args })
            return { status: 0, signal: null, stdout: '', stderr: '' }
          },
        },
      })

      // Then: only the helper path and environment name cross the process boundary
      expect(calls).toEqual([{
        file: process.execPath,
        args: [
          join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs'),
          '--launchctl-setenv',
          VALUE.AuthEnvironment,
        ],
      }])
      expect(JSON.stringify({ calls, warnings: result.warnings })).not.toContain(VALUE.ApiKey)
    },
  )
})
