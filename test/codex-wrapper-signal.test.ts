import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const wrapperEntrypoint = join(
  repositoryRoot,
  'packages',
  'codex-litellm',
  'bin',
  'codex-litellm.mjs',
)

describe('codex-litellm wrapper', () => {
  test('propagates a child termination signal', async () => {
    const fixture = createSignalFixture()

    try {
      const result = await runFixture(fixture.executable)

      expect(result.code).toBeNull()
      expect(result.signal).toBe('SIGTERM')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

type SignalFixture = {
  readonly root: string
  readonly executable: string
}

function createSignalFixture(): SignalFixture {
  const root = mkdtempSync(join(tmpdir(), 'codex-litellm-wrapper-signal-'))
  const executable = join(root, 'packages', 'codex-litellm', 'bin', 'codex-litellm.mjs')
  const coreRoot = join(
    root,
    'packages',
    'codex-litellm',
    'node_modules',
    '@happycastle114',
    'opencode-litellm',
  )

  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(coreRoot, { recursive: true })
  copyFileSync(wrapperEntrypoint, executable)
  writeFileSync(
    join(coreRoot, 'package.json'),
    `${JSON.stringify({
      name: '@happycastle114/opencode-litellm',
      type: 'module',
      exports: { './cli': './fake-cli.mjs' },
    })}\n`,
  )
  writeFileSync(
    join(coreRoot, 'fake-cli.mjs'),
    "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50)\n",
  )

  return { root, executable }
}

type ProcessResult = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

function runFixture(executable: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [executable], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
}
