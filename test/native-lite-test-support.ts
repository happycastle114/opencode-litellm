import { readFileSync, unlinkSync } from 'node:fs'
import type { NativeLiteBoundary } from '../src/cli/native-lite'

export const NativeLiteTestOutput = {
  LogoutSuccess: 'Logged out successfully. Authentication token cleared.\n',
} as const

const NATIVE_COMMAND = { Token: 'auth', Logout: 'logout' } as const

export function nativeTokenBoundary(tokenFilePath: string): NativeLiteBoundary {
  return {
    spawn: (_file, args) => {
      const parsed: unknown = JSON.parse(readFileSync(tokenFilePath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null ||
        !('base_url' in parsed) || parsed.base_url !== args[1]) {
        return { status: 1, stdout: '', stderr: 'fixture origin mismatch' }
      }
      switch (args[2]) {
        case NATIVE_COMMAND.Token:
          return 'key' in parsed && typeof parsed.key === 'string'
            ? { status: 0, stdout: `${parsed.key}\n`, stderr: '' }
            : { status: 1, stdout: '', stderr: 'fixture credential missing' }
        case NATIVE_COMMAND.Logout:
          unlinkSync(tokenFilePath)
          return { status: 0, stdout: NativeLiteTestOutput.LogoutSuccess, stderr: '' }
        default:
          throw new Error('Unexpected native authentication command in test fixture.')
      }
    },
  }
}
