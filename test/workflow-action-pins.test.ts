import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const commitShaPattern = /^[0-9a-f]{40}$/

const expectedActions = {
  'ci.yml': [
    ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1', 'v7.0.1'],
    ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020', 'v7.0.0'],
    ['oven-sh/setup-bun', '0c5077e51419868618aeaa5fe8019c62421857d6', 'v2.2.0'],
    ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1', 'v7.0.1'],
    ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020', 'v7.0.0'],
  ],
  'release.yml': [
    ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1', 'v7.0.1'],
    ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020', 'v7.0.0'],
    ['oven-sh/setup-bun', '0c5077e51419868618aeaa5fe8019c62421857d6', 'v2.2.0'],
  ],
} as const

describe('GitHub workflow action supply-chain pins', () => {
  for (const [workflow, expected] of Object.entries(expectedActions)) {
    test(`${workflow} uses only reviewed immutable action revisions`, () => {
      const source = readFileSync(join(repositoryRoot, '.github', 'workflows', workflow), 'utf8')
      const actual = Array.from(
        source.matchAll(
          /^\s*(?:-\s*)?uses:\s*([^@\s#]+)@([^\s#]+)\s+#\s+(v\d+(?:\.\d+){0,2})\s*$/gm,
        ),
        ([, action, revision, version]) => [action, revision, version],
      )

      expect(actual).toEqual(expected)
      expect(actual.every(([, revision]) => commitShaPattern.test(revision))).toBe(true)
      expect((source.match(/^\s*(?:-\s*)?uses:/gm) ?? []).length).toBe(actual.length)
    })
  }
})
