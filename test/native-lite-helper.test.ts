import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderNativeLiteAuthHelper } from '../src/cli/native-lite-helper'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'native-lite-helper-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

test('direct Codex helper enforces file authentication without inheriting ambient credentials', () => {
  const helper = join(home, 'auth.mjs')
  writeFileSync(helper, renderNativeLiteAuthHelper('https://gateway.example.test', home))
  const lite = join(home, 'lite')
  writeFileSync(lite, `#!/usr/bin/env node
if (process.env.LITELLM_CLI_DISABLE_KEYRING !== '1' || process.env.HOME !== ${JSON.stringify(home)} ||
    process.env.LITELLM_PROXY_API_KEY || process.env.LITELLM_PROXY_URL ||
    JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--base-url', 'https://gateway.example.test', 'auth', 'print-token'])) {
  process.stderr.write('unsafe authentication environment'); process.exit(1)
}
process.stdout.write('sk-fixture-only\\n')
`)
  chmodSync(lite, 0o700)
  const env = { ...process.env, PATH: `${home}:${process.env.PATH}`, HOME: '/wrong-home',
    LITELLM_CLI_DISABLE_KEYRING: '0', LITELLM_PROXY_API_KEY: 'stale', LITELLM_PROXY_URL: 'https://wrong.example.test' }
  const result = spawnSync(process.execPath, [helper], { env, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('sk-fixture-only\n')
  expect(result.stderr).toBe('')
})

test('direct Codex helper suppresses credential-bearing native failures', () => {
  const helper = join(home, 'auth.mjs')
  writeFileSync(helper, renderNativeLiteAuthHelper('https://gateway.example.test', home))
  const lite = join(home, 'lite')
  writeFileSync(lite, '#!/usr/bin/env node\nprocess.stderr.write("sk-sensitive-fixture"); process.exit(1)\n')
  chmodSync(lite, 0o700)
  const result = spawnSync(process.execPath, [helper], { encoding: 'utf8',
    env: { ...process.env, PATH: `${home}:${process.env.PATH}` } })
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('codex-litellm login')
  expect(result.stderr).not.toContain('sk-sensitive-fixture')
})
