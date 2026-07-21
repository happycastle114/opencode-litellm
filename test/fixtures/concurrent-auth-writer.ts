import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCliProgram } from '../../src/cli/program'

const MODE = {
  Install: 'install',
  Login: 'login',
  Logout: 'logout',
} as const
const NO_PATH = '-'

const [mode, homeDirectory, origin, apiKey, startedPath, tokenPath, allowPath,
  completedPath] = process.argv.slice(2)
if (mode === undefined || homeDirectory === undefined || origin === undefined ||
  apiKey === undefined || startedPath === undefined || tokenPath === undefined ||
  allowPath === undefined || completedPath === undefined) {
  throw new Error('Concurrent auth writer arguments are incomplete.')
}

writeFileSync(startedPath, `${mode}\n`)
const context = {
  env: { HOME: homeDirectory },
  now: () => new Date(1_234_000),
  externalSetup: false,
  platform: 'linux',
  onboardingIO: {
    isTTY: true,
    prompt: promptFrom(['', '', '', '', 'y']),
    write: () => undefined,
  },
  ssoBoundaries: {
    open: async () => undefined,
    selectTeam: async () => undefined,
  },
  ssoOnboarding: async (input: { readonly tokenFilePath?: string }) => {
    const destination = input.tokenFilePath
    if (destination === undefined) throw new Error('Token path is missing.')
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, JSON.stringify({
      base_url: origin,
      key: apiKey,
      user_id: mode,
      user_role: 'cli',
      timestamp: 1234,
    }))
    if (tokenPath !== NO_PATH) writeFileSync(tokenPath, `${origin}\n`)
    if (allowPath !== NO_PATH) await waitForFile(allowPath)
    return { status: 'authenticated' as const }
  },
  gatewayDiscovery: async () => ({
    models: [{ id: 'gateway-model' }],
    searchToolNames: [],
    mcpServerNames: [],
    toolsets: [],
    warnings: [],
  }),
} as const

const result = await runCliProgram(command(mode, origin), context)
writeFileSync(completedPath, JSON.stringify(result))
process.stdout.write(JSON.stringify(result))
process.exitCode = result.exitCode

function command(selectedMode: string, baseUrl: string): readonly string[] {
  switch (selectedMode) {
    case MODE.Install:
      return [
        MODE.Install,
        '--target', 'opencode',
        '--base-url', baseUrl,
        '--auth', 'sso',
        '--no-search',
        '--no-mcp',
        '--no-toolsets',
      ]
    case MODE.Login:
      return [MODE.Login, '--base-url', baseUrl]
    case MODE.Logout:
      return [MODE.Logout, '--base-url', baseUrl]
    default:
      throw new Error(`Unsupported concurrent writer mode: ${selectedMode}`)
  }
}

function promptFrom(answers: string[]): () => Promise<string> {
  return async () => answers.shift() ?? ''
}

async function waitForFile(path: string): Promise<void> {
  while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 10))
}
