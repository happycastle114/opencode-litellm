import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import {
  createNodeOnboardingIO,
  type NodeReadline,
  type NodeTerminalOutput,
} from '../src/cli/node-onboarding-boundaries'

describe('Node onboarding terminal IO', () => {
  test('uses one readline interface and closes it exactly once', async () => {
    // Given: a TTY stream and the existing prompt boundary.
    const writes: string[] = []
    const questions: string[] = []
    let closeCount = 0
    let createCount = 0
    const readline: NodeReadline = {
      question: async (message) => { questions.push(message); return 'answer' },
      close: () => { closeCount += 1 },
    }
    const input = Object.assign(new PassThrough(), { isTTY: true })
    const output: NodeTerminalOutput = { write: (message: string) => { writes.push(message); return true } }
    // When: onboarding prompts and releases its terminal before native login.
    const io = createNodeOnboardingIO({ input, output, readline: () => { createCount += 1; return readline } })
    const answer = await io.prompt('Question: ')
    io.write('status')
    io.close()
    io.close()
    // Then: no duplicate terminal readers or close operations remain.
    expect(answer).toBe('answer')
    expect(io.isTTY).toBe(true)
    expect(createCount).toBe(1)
    expect(questions).toEqual(['Question: '])
    expect(writes).toEqual(['status\n'])
    expect(closeCount).toBe(1)
    input.destroy()
  })
})
