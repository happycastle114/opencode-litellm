#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const CLI_ARGUMENT = Object.freeze({
  Install: 'install',
  TargetOption: '--target',
  CodexTarget: 'codex',
})

const require = createRequire(import.meta.url)
const cliPath = require.resolve('@happycastle114/opencode-litellm/cli')
const args = process.argv.slice(2)
const forwardedArgs = args[0] === CLI_ARGUMENT.Install && !args.includes(CLI_ARGUMENT.TargetOption)
  ? [
      CLI_ARGUMENT.Install,
      CLI_ARGUMENT.TargetOption,
      CLI_ARGUMENT.CodexTarget,
      ...args.slice(1),
    ]
  : args
const child = spawn(process.execPath, [cliPath, ...forwardedArgs], {
  stdio: 'inherit',
})

child.on('error', () => {
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 1)
})
