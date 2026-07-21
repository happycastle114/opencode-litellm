import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../src/cli/program'
import { resolveLaunchConfigPath } from '../src/cli/launch-config'
import { resolveOhMyOpenAgentProfilePath } from '../src/cli/qwen-routing'

const VALUE = {
  ApiKey: 'destination-atomicity-key',
  AuthEnvironment: 'LITELLM_PROXY_API_KEY',
  GatewayOrigin: 'https://litellm.example.test',
} as const
const FILE_MODE = 0o640

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(tmpdir(), 'client-destination-atomicity-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('public installer destination atomicity', () => {
  test('does not let a stale PID staging directory block a later install', async () => {
    // Given: valid managed files and a legacy PID-scoped staging directory
    const openCodePath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc')
    const profilePath = resolveOhMyOpenAgentProfilePath(openCodePath)
    const skillPath = sharedSkillPath()
    seedFiles(new Map([
      [openCodePath, '{\n  "keep": "opencode"\n}\n'],
      [profilePath, '{\n  "keep": "profile"\n}\n'],
      [skillPath, '# keep skill\n'],
    ]))
    const launchPath = resolveLaunchConfigPath({ HOME: homeDirectory })
    mkdirSync(dirname(launchPath), { recursive: true })
    const legacyStagePath = `${launchPath}.${process.pid}.tmp`
    mkdirSync(legacyStagePath)

    // When: the public OpenCode install uses a fresh transaction UUID
    const result = await runCliProgram(installArgs('opencode', [
      '--opencode-config', openCodePath,
    ]), programContext())

    // Then: installation converges while preserving the unrelated legacy directory
    expect(result.exitCode).toBe(0)
    expect(existsSync(launchPath)).toBe(true)
    expect(statSync(legacyStagePath).isDirectory()).toBe(true)
  })

  test('does not mutate Codex when the shared skill destination is a directory', async () => {
    // Given: valid existing Codex assets and a non-file shared skill destination
    const codexPath = join(homeDirectory, '.codex', 'config.toml')
    const helperPath = join(homeDirectory, '.codex', 'libexec', 'litellm-auth-token.mjs')
    const catalogPath = join(homeDirectory, '.codex', 'litellm-models.json')
    const existing = seedFiles(new Map([
      [codexPath, 'model = "keep"\n'],
      [helperPath, '// keep helper\n'],
      [catalogPath, '{"keep":"catalog"}\n'],
    ]))
    mkdirSync(sharedSkillPath(), { recursive: true })
    const launchPath = resolveLaunchConfigPath({ HOME: homeDirectory })

    // When: the public Codex install plans the shared destination
    const result = await runCliProgram(installArgs('codex', [
      '--codex-config', codexPath,
      '--codex-mode', 'gateway',
    ]), programContext())

    // Then: the destination type error precedes helper, catalog, config, and launch writes
    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toBe('')
    expectSnapshots(existing)
    expect(statSync(sharedSkillPath()).isDirectory()).toBe(true)
    expect(existsSync(launchPath)).toBe(false)
    expect(findBackups(homeDirectory)).toEqual([])
  })
})

function installArgs(
  target: 'opencode' | 'codex',
  extra: readonly string[],
): readonly string[] {
  return [
    'install',
    '--target', target,
    '--base-url', VALUE.GatewayOrigin,
    '--auth', 'env',
    '--auth-env', VALUE.AuthEnvironment,
    '--non-interactive',
    '--no-search',
    '--no-mcp',
    '--no-toolsets',
    ...extra,
  ]
}

function programContext() {
  return {
    env: { HOME: homeDirectory, [VALUE.AuthEnvironment]: VALUE.ApiKey },
    now: () => new Date(0),
    externalSetup: false,
    gatewayDiscovery: async () => ({
      models: [{ id: 'gateway-model' }],
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [],
    }),
  } as const
}

type FileSnapshot = {
  readonly path: string
  readonly contents: Buffer
  readonly mode: number
}

function seedFiles(files: ReadonlyMap<string, string>): readonly FileSnapshot[] {
  const snapshots: FileSnapshot[] = []
  for (const [path, contents] of files) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
    chmodSync(path, FILE_MODE)
    snapshots.push({ path, contents: readFileSync(path), mode: FILE_MODE })
  }
  return snapshots
}

function expectSnapshots(snapshots: readonly FileSnapshot[]): void {
  for (const snapshot of snapshots) {
    expect(readFileSync(snapshot.path)).toEqual(snapshot.contents)
    expect(statSync(snapshot.path).mode & 0o777).toBe(snapshot.mode)
  }
}

function sharedSkillPath(): string {
  return join(
    homeDirectory,
    '.agents',
    'skills',
    'litellm-research-router',
    'SKILL.md',
  )
}

function findBackups(root: string): readonly string[] {
  const matches: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (name.endsWith('.bak')) matches.push(path)
      else if (statSync(path).isDirectory()) visit(path)
    }
  }
  visit(root)
  return matches
}
