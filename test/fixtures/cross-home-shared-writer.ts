import { existsSync, linkSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { runCliProgram } from '../../src/cli/program'

const [homeDirectory, sharedConfig, origin, apiKey, writerName, barrierDirectory] =
  process.argv.slice(2)
if (homeDirectory === undefined || sharedConfig === undefined || origin === undefined ||
  apiKey === undefined || writerName === undefined || barrierDirectory === undefined) {
  throw new Error('Cross-home writer arguments are incomplete.')
}

let synchronized = false
writeFileSync(join(barrierDirectory, `${writerName}-started`), 'started\n')
const result = await runCliProgram([
  'install', '--target', 'opencode', '--base-url', origin,
  '--auth', 'env', '--auth-env', 'SHARED_WRITER_KEY',
  '--opencode-config', sharedConfig, '--non-interactive',
  '--no-search', '--no-mcp', '--no-toolsets',
], {
  env: { HOME: homeDirectory, SHARED_WRITER_KEY: apiKey },
  now: () => new Date(0),
  gatewayDiscovery: async () => ({
    models: [], searchToolNames: [], mcpServerNames: [], toolsets: [], warnings: [],
  }),
  clientInstallCommitBoundary: {
    moveExclusive: (source, destination) => {
      if (!synchronized && source === sharedConfig) {
        synchronized = true
        writeFileSync(join(barrierDirectory, `${writerName}-entered`), 'entered\n')
        if (writerName === 'a') waitForPeer(join(barrierDirectory, 'allow-a'))
      }
      linkSync(source, destination)
      unlinkSync(source)
    },
  },
})

process.stdout.write(JSON.stringify(result))

function waitForPeer(path: string): void {
  const deadline = Date.now() + 5_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('Cross-home barrier timed out.')
    blockFor(10)
  }
}

function blockFor(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
