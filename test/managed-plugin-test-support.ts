export const MANAGED_PLUGIN = {
  repository: 'https://github.com/happycastle114/opencode-litellm.git',
  revision: '83ea2674a8afb578a670188fb3b522fc242a77cb',
  checkoutDirectory: 'opencode-litellm-git',
  entrypoint: 'src/index.ts',
} as const

export const COMMAND_RESULT = {
  correctOrigin: { exitCode: 0, stdout: `${MANAGED_PLUGIN.repository}\n`, stderr: '' },
  wrongOrigin: { exitCode: 0, stdout: 'https://attacker.example.test/plugin.git\n', stderr: '' },
  clean: { exitCode: 0, stdout: '', stderr: '' },
  dirty: { exitCode: 0, stdout: ' M src/index.ts\n', stderr: '' },
  correctHead: { exitCode: 0, stdout: `${MANAGED_PLUGIN.revision}\n`, stderr: '' },
  fetchFailure: { exitCode: 1, stdout: '', stderr: 'fetch failed' },
  npmCiFailure: { exitCode: 1, stdout: '', stderr: 'npm ci failed' },
  unexpected: { exitCode: 127, stdout: '', stderr: 'unexpected command' },
} as const

export const FULL_GIT_SHA = /^[0-9a-f]{40}$/
export const FILE_SYSTEM_ERROR_CODE = { NotDirectory: 'ENOTDIR' } as const
export const BASE_INTENT = {
  baseUrl: 'https://llm.example.test',
  authEnv: 'OPENCODE_LITELLM_API_KEY',
  search: [],
  mcp: [],
  disableMcp: [],
} as const

export type CommandInvocation = {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd?: string
}

export function createBoundary(
  results: readonly (typeof COMMAND_RESULT)[keyof typeof COMMAND_RESULT][],
  exists: (path: string) => boolean = () => true,
  isFile: (path: string) => boolean = () => true,
) {
  const calls: CommandInvocation[] = []
  let index = 0
  return {
    calls,
    boundary: {
      fs: { exists, isFile },
      command: {
        run: async (invocation: CommandInvocation) => {
          calls.push(invocation)
          const result = results[index]
          index += 1
          return result ?? COMMAND_RESULT.unexpected
        },
      },
    },
  }
}

export function createRetryBoundary(activePath: string) {
  const calls: CommandInvocation[] = []
  const existingPaths = new Set([activePath])
  const stagedPaths: string[] = []
  const removedPaths: string[] = []
  const renamedPaths: Array<{ source: string; destination: string }> = []
  let npmCiAttempts = 0
  return {
    calls,
    stagedPaths,
    removedPaths,
    renamedPaths,
    boundary: {
      fs: {
        exists: (path: string) => existingPaths.has(path),
        isFile: () => true,
        remove: (path: string) => {
          existingPaths.delete(path)
          removedPaths.push(path)
        },
        rename: (source: string, destination: string) => {
          existingPaths.delete(source)
          existingPaths.add(destination)
          renamedPaths.push({ source, destination })
        },
      },
      command: {
        run: async (invocation: CommandInvocation) => {
          calls.push(invocation)
          if (invocation.executable === 'git' && invocation.args[0] === 'clone') {
            const stagingPath = invocation.args.at(-1)
            if (stagingPath === undefined) return COMMAND_RESULT.unexpected
            existingPaths.add(stagingPath)
            stagedPaths.push(stagingPath)
            return COMMAND_RESULT.clean
          }
          if (invocation.executable === 'npm') {
            npmCiAttempts += 1
            return npmCiAttempts === 1
              ? COMMAND_RESULT.npmCiFailure
              : COMMAND_RESULT.clean
          }
          if (invocation.args[2] === 'remote') return COMMAND_RESULT.correctOrigin
          if (invocation.args[2] === 'rev-parse') return COMMAND_RESULT.correctHead
          return COMMAND_RESULT.clean
        },
      },
    },
  }
}
