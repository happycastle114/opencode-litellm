import { describe, expect, test } from 'bun:test'
import {
  NodePlatform,
  NodeSsoBoundaryError,
  createNodeOnboardingIO,
  createNodeSsoOnboardingBoundaries,
  type NodeReadline,
  type NodeSpawnCall,
  type NodeTerminalOutput,
} from '../src/cli/node-onboarding-boundaries'

describe('Node onboarding boundaries', () => {
  test('uses one injected readline interface and exposes a closable terminal IO', async () => {
    // Given: a TTY-like input stream and a fake readline interface
    const writes: string[] = []
    const questions: string[] = []
    const answers = ['answer']
    let closeCount = 0
    let createCount = 0
    let capturedOutput: NodeTerminalOutput | undefined
    const readline: NodeReadline = {
      question: async (message) => {
        questions.push(message)
        return answers.shift() ?? ''
      },
      close: () => { closeCount += 1 },
    }
    const input = { isTTY: true } as NodeJS.ReadableStream & { readonly isTTY: boolean }
    const output: NodeTerminalOutput = { write: (message: string) => { writes.push(message); return true } }

    // When: the node IO adapter is created and used
    const io = createNodeOnboardingIO({
      input,
      output,
      readline: (options) => {
        createCount += 1
        capturedOutput = options.output
        return readline
      },
    })
    const answer = await io.prompt('Question: ')
    io.write('status')
    io.close()
    io.close()

    // Then: one interface is shared, terminal state is preserved, and close is idempotent
    expect(answer).toBe('answer')
    expect(io.isTTY).toBe(true)
    expect(createCount).toBe(1)
    expect(capturedOutput).toBe(output)
    expect(questions).toEqual(['Question: '])
    expect(writes).toEqual(['status\n'])
    expect(closeCount).toBe(1)
  })

  test('opens verification with the platform launcher and defaults a single team', async () => {
    // Given: a Linux launcher and an SSO IO boundary
    const calls: NodeSpawnCall[] = []
    const writes: string[] = []
    let promptCount = 0
    const io = {
      isTTY: true,
      prompt: async () => { promptCount += 1; return '' },
      write: (message: string) => { writes.push(message) },
      close: () => undefined,
    }
    const boundaries = createNodeSsoOnboardingBoundaries(io, {
      platform: NodePlatform.Linux,
      spawn: (file, args, options) => {
        calls.push({ file, args, options })
      },
    })

    // When: verification is opened and one team is selected
    await boundaries.open({ url: 'https://llm.example.test/verify?key=public', userCode: 'ABCD-EFGH' })
    const selected = await boundaries.selectTeam([{ teamId: 'team-a', teamAlias: 'Alpha' }])

    // Then: only non-credential SSO details are displayed and the native launcher is deterministic
    expect(selected).toBe('team-a')
    expect(promptCount).toBe(0)
    expect(calls).toEqual([{
      file: 'xdg-open',
      args: ['https://llm.example.test/verify?key=public'],
      options: { detached: true, stdio: 'ignore' },
    }])
    expect(writes.join('\n')).toContain('https://llm.example.test/verify?key=public')
    expect(writes.join('\n')).toContain('ABCD-EFGH')
    expect(writes.join('\n')).toContain('Alpha')
    expect(writes.join('\n')).toContain('team-a')
    expect(writes.join('\n')).not.toContain('sk-')
  })

  test('validates numbered team selection and reports a stable launch failure', async () => {
    // Given: a fake Windows launcher and a user who first enters an invalid team number
    const writes: string[] = []
    const answers = ['9', '2']
    const io = {
      isTTY: true,
      prompt: async () => answers.shift() ?? '',
      write: (message: string) => { writes.push(message) },
      close: () => undefined,
    }
    const boundaries = createNodeSsoOnboardingBoundaries(io, {
      platform: NodePlatform.Windows,
      spawn: () => { throw new Error('ENOENT secret-skipping-detail') },
    })

    // When: the two-team prompt is answered, then browser launch fails
    const selected = await boundaries.selectTeam([
      { teamId: 'team-a' },
      { teamId: 'team-b', teamAlias: 'Beta' },
    ])
    let failure: unknown
    try {
      await boundaries.open({ url: 'https://llm.example.test/verify', userCode: 'CODE-1234' })
    } catch (error) {
      if (error instanceof NodeSsoBoundaryError) {
        failure = error
      } else {
        throw error
      }
    }

    // Then: selection is validated and the launch error is typed and deterministic
    expect(selected).toBe('team-b')
    expect(writes.some((message) => message.includes('Enter one of the listed team numbers.'))).toBe(true)
    expect(failure).toBeInstanceOf(NodeSsoBoundaryError)
    expect(failure).toMatchObject({ code: 'browser-launch-failed', platform: NodePlatform.Windows })
    expect(String(failure)).not.toContain('secret-skipping-detail')
  })
})
