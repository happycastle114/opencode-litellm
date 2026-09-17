import { expect, spyOn } from 'bun:test'
import * as childProcess from 'node:child_process'
import { readFileSync } from 'node:fs'

const NATIVE_COMMAND = { Executable: 'lite', Auth: 'auth', Token: 'print-token' } as const

export function nativeTokenSpy(tokenFilePath: string) {
  return spyOn(childProcess, 'spawnSync').mockImplementation((file, args) => {
    expect(file).toBe(NATIVE_COMMAND.Executable)
    expect(Array.isArray(args)).toBe(true)
    if (!Array.isArray(args)) throw new Error('Expected native token arguments')
    expect(args.slice(2)).toEqual([NATIVE_COMMAND.Auth, NATIVE_COMMAND.Token])
    const token: unknown = JSON.parse(readFileSync(tokenFilePath, 'utf8'))
    if (typeof token !== 'object' || token === null ||
      !('base_url' in token) || token.base_url !== args[1] ||
      !('key' in token) || typeof token.key !== 'string') {
      throw new Error('Invalid native credential fixture')
    }
    return { status: 0, stdout: `${token.key}\n`, stderr: '', pid: 0, output: [], signal: null }
  })
}
