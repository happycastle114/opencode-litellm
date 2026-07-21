import { afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DISCOVERY = {
  models: [{ id: 'coding-fast' }],
  searchToolNames: ['agy-search'],
  mcpServerNames: ['zread'],
  toolsets: [],
  warnings: [],
} as const

export const BUNDLED_CATALOG_FIXTURE = readFileSync(
  new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
  'utf8',
)

export function setupProgramHome(prefix: string, assign: (path: string) => void): void {
  let current: string | undefined
  beforeEach(() => {
    current = mkdtempSync(join(tmpdir(), prefix))
    assign(current)
  })
  afterEach(() => {
    if (current !== undefined) rmSync(current, { recursive: true, force: true })
    current = undefined
  })
}
