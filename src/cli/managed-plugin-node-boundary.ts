import { spawn } from 'node:child_process'
import { existsSync, lstatSync, renameSync, rmSync } from 'node:fs'
import type {
  ManagedPluginBoundary,
  ManagedPluginCommandInvocation,
  ManagedPluginCommandResult,
} from './managed-plugin-types'

export function nodeManagedPluginBoundary(): ManagedPluginBoundary {
  return {
    fs: {
      exists: existsSync,
      isFile: isRegularFile,
      rename: (source, destination) => renameSync(source, destination),
      remove: (path) => rmSync(path, { recursive: true, force: true }),
    },
    command: { run: runNodeCommand },
  }
}

function isRegularFile(path: string): boolean {
  try { return lstatSync(path).isFile() } catch { return false }
}

function runNodeCommand(
  invocation: ManagedPluginCommandInvocation,
): Promise<ManagedPluginCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.executable, [...invocation.args], {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout !== null) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
    }
    if (child.stderr !== null) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }
    child.on('error', (error: Error) => {
      resolve({ exitCode: 127, stdout, stderr: error.message })
    })
    child.on('close', (exitCode: number | null) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}
