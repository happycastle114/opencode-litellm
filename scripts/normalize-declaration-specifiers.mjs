import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const declarationRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const localSpecifier = /(\bfrom\s*['"])(\.\.?\/[^'"]+)(['"])/g

for (const path of declarationFiles(declarationRoot)) {
  const source = readFileSync(path, 'utf8')
  const normalized = source.replace(
    localSpecifier,
    (match, prefix, specifier, suffix) => {
      if (specifier.endsWith('.js') || specifier.endsWith('.mjs')) {
        return match
      }
      const target = join(dirname(path), specifier)
      const fileTarget = [
        ['.d.ts', '.js'],
        ['.d.mts', '.mjs'],
        ['.d.cts', '.cjs'],
      ].find(([declarationExtension]) =>
        existsSync(`${target}${declarationExtension}`),
      )
      if (fileTarget) {
        return `${prefix}${specifier}${fileTarget[1]}${suffix}`
      }
      const directoryTarget = [
        ['index.d.ts', 'index.js'],
        ['index.d.mts', 'index.mjs'],
        ['index.d.cts', 'index.cjs'],
      ].find(([declarationFile]) =>
        existsSync(join(target, declarationFile)),
      )
      if (directoryTarget) {
        return `${prefix}${specifier}/${directoryTarget[1]}${suffix}`
      }
      return match
    },
  )
  if (normalized !== source) writeFileSync(path, normalized)
}

function* declarationFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      yield* declarationFiles(path)
      continue
    }
    if (entry.endsWith('.d.ts') || entry.endsWith('.d.mts')) yield path
  }
}
