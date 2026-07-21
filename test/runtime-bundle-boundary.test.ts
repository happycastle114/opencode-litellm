import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const runtimeBundlePath = fileURLToPath(new URL('../dist/index.mjs', import.meta.url))
const installerOnlyMarkers = [
  'ReservedAuthEnvironment',
  'ToolkitDefault',
  'CODEX_HOME',
  'OPENCODE_CONFIG',
  'llm.soungmin.kr',
] as const

test('runtime bundle does not pull installer-only install intent state', () => {
  const bundle = readFileSync(runtimeBundlePath, 'utf8')
  for (const marker of installerOnlyMarkers) {
    expect(bundle).not.toContain(marker)
  }
})
