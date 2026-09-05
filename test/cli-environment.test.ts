import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { normalizeCliEnvironment } from '../src/cli/environment'

test('uses USERPROFILE for Windows shells without HOME and preserves explicit HOME', () => {
  const profile = 'C:\\Users\\Student'
  expect(normalizeCliEnvironment({ USERPROFILE: profile, PATH: 'C:\\Windows' })).toEqual({
    HOME: profile, USERPROFILE: profile, PATH: 'C:\\Windows',
  })
  expect(normalizeCliEnvironment({ HOME: '/custom', USERPROFILE: profile }).HOME).toBe('/custom')
  expect(normalizeCliEnvironment({}).HOME).toBe(homedir())
})
