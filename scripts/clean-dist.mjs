import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const distributionRoot = fileURLToPath(new URL('../dist/', import.meta.url))

rmSync(distributionRoot, { recursive: true, force: true })
