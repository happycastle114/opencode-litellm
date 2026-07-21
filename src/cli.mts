#!/usr/bin/env node

import {
  applyBinaryDefaults,
  needsNodeOnboardingBoundary,
} from './cli/command'
import {
  createNodeOnboardingIO,
  createNodeSsoOnboardingBoundaries,
} from './cli/node-onboarding-boundaries'
import { runCliProgram } from './cli/program'

const argv = applyBinaryDefaults(process.argv.slice(2), process.argv[1] ?? '')
const onboardingIO = needsNodeOnboardingBoundary(argv)
  ? createNodeOnboardingIO()
  : undefined
let result
try {
  result = await runCliProgram(
    argv,
    {
      env: process.env,
      now: () => new Date(),
      externalSetup: true,
      ...(onboardingIO === undefined
        ? {}
        : {
            onboardingIO,
            releaseOnboardingTerminal: () => onboardingIO.close(),
            ssoBoundaries: createNodeSsoOnboardingBoundaries(onboardingIO),
          }),
    },
  )
} finally {
  onboardingIO?.close()
}

if (result.stdout !== '') process.stdout.write(result.stdout)
if (result.stderr !== '') process.stderr.write(result.stderr)
process.exitCode = result.exitCode
