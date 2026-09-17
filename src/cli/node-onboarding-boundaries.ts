import { Writable } from 'node:stream'
import {
  createInterface as createReadlineInterface,
  type Interface as ReadlineInterface,
  type ReadLineOptions,
} from 'node:readline/promises'
import type { OnboardingIO } from './onboarding'

export type NodeReadline = Pick<ReadlineInterface, 'question' | 'close'>
export type NodeReadlineOptions = Omit<ReadLineOptions, 'input' | 'output'> & {
  readonly input: NodeTerminalInput
  readonly output: NodeTerminalOutput
}
export type NodeReadlineFactory = (options: NodeReadlineOptions) => NodeReadline
export type NodeReadlineBoundary =
  | NodeReadlineFactory
  | { readonly createInterface: NodeReadlineFactory }
export type NodeTerminalInput = NodeJS.ReadableStream & { readonly isTTY?: boolean }
export type NodeTerminalOutput = Pick<NodeJS.WritableStream, 'write'>

export type NodeOnboardingIOOptions = {
  readonly input?: NodeTerminalInput
  readonly output?: NodeTerminalOutput
  readonly readline?: NodeReadlineBoundary
}

export type NodeOnboardingIO = OnboardingIO & { readonly close: () => void }

export function createNodeOnboardingIO(options: NodeOnboardingIOOptions = {}): NodeOnboardingIO {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const readline = options.readline === undefined
    ? createReadlineInterface({ input, output: readlineOutput(output), terminal: input.isTTY === true })
    : resolveReadline(options.readline)({ input, output, terminal: input.isTTY === true })
  let closed = false
  return {
    isTTY: input.isTTY === true,
    prompt: (message) => readline.question(message),
    write: (message) => { output.write(`${message}\n`) },
    close: () => {
      if (closed) return
      closed = true
      readline.close()
    },
  }
}

function resolveReadline(boundary: NodeReadlineBoundary): NodeReadlineFactory {
  return typeof boundary === 'function' ? boundary : boundary.createInterface
}

function readlineOutput(output: NodeTerminalOutput): NodeJS.WritableStream {
  if (output === process.stdout) return process.stdout
  return new Writable({
    write(chunk, _encoding, callback) {
      output.write(typeof chunk === 'string' ? chunk : chunk.toString())
      callback()
    },
  })
}
