import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCliArgs } from '../src/cli/command'
import { inspectOpenCodeConfig } from '../src/cli/doctor'

const PLUGIN_SPEC = 'file:///tmp/opencode-litellm-git/src/index.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oc-litellm-doctor-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeConfig(contents: string): string {
  const path = join(dir, 'opencode.jsonc')
  writeFileSync(path, contents)
  return path
}

describe('doctor argument parsing', () => {
  test('parses target, json, and config path options', () => {
    // Given: a doctor invocation with all supported options
    // When: parsed
    const parsed = parseCliArgs([
      'doctor',
      '--target',
      'opencode',
      '--json',
      '--opencode-config',
      '/tmp/opencode.jsonc',
      '--codex-config',
      '/tmp/config.toml',
    ])

    // Then: a typed doctor invocation carries every option
    expect(parsed).toEqual({
      kind: 'command',
      command: 'doctor',
      help: false,
      options: {
        target: 'opencode',
        json: true,
        opencodeConfig: '/tmp/opencode.jsonc',
        codexConfig: '/tmp/config.toml',
      },
    })
  })
})

describe('doctor opencode inspection', () => {
  test('reports healthy checks for a well-formed config', () => {
    // Given: a valid installed config
    const path = writeConfig(`{
  "plugin": ["${PLUGIN_SPEC}"],
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai",
      "name": "LiteLLM",
      "options": { "baseURL": "https://litellm.example.com/v1", "apiKey": "{env:LITELLM_API_KEY}" }
    }
  }
}`)
    // When: inspected
    const report = inspectOpenCodeConfig(path)

    // Then: all checks pass
    expect(report.status).toBe('ok')
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true)
    const codes = report.checks.map((c) => c.code)
    expect(codes).toContain('syntax')
    expect(codes).toContain('plugin')
    expect(codes).toContain('provider')
  })

  test('reports a not-configured status for a missing file', () => {
    // Given: a config path that does not exist
    const path = join(dir, 'absent.jsonc')
    // When: inspected
    const report = inspectOpenCodeConfig(path)

    // Then: the report is degraded but does not throw
    expect(report.status).not.toBe('ok')
    expect(report.checks.some((c) => c.code === 'file')).toBe(true)
  })

  test('keeps a legacy registry plugin visible as a migration warning', () => {
    const path = writeConfig(`{
  "plugin": ["opencode-plugin-litellm@legacy"],
  "provider": { "litellm": { "npm": "@ai-sdk/openai", "options": { "baseURL": "https://x.example.com/v1" } } }
}`)

    const report = inspectOpenCodeConfig(path)

    expect(report.status).toBe('warn')
    expect(report.checks.some((entry) => entry.code === 'plugin' && entry.status === 'warn')).toBe(true)
  })

  test('reports a syntax error for malformed JSONC without throwing', () => {
    // Given: a malformed config file
    const path = writeConfig('{ "plugin": [')
    // When: inspected
    const report = inspectOpenCodeConfig(path)

    // Then: a syntax check fails
    expect(report.status).toBe('error')
    expect(report.checks.some((c) => c.code === 'syntax' && c.status === 'error')).toBe(true)
  })

  test('is read-only and never mutates the inspected file', () => {
    // Given: a config file with distinctive formatting
    const contents = `{
  // keep me
  "plugin": ["${PLUGIN_SPEC}"],
  "provider": { "litellm": { "npm": "@ai-sdk/openai", "name": "LiteLLM", "options": { "baseURL": "https://x.example.com/v1", "apiKey": "{env:K}" } } }
}`
    const path = writeConfig(contents)
    // When: inspected
    inspectOpenCodeConfig(path)

    // Then: the file bytes are unchanged
    expect(readFileSync(path, 'utf8')).toBe(contents)
  })

  test('never resolves or prints the environment secret value', () => {
    // Given: a config whose env var is set to a secret in the process
    process.env.LITELLM_DOCTOR_SECRET = 'sk-should-never-appear'
    const path = writeConfig(`{
  "plugin": ["${PLUGIN_SPEC}"],
  "provider": { "litellm": { "npm": "@ai-sdk/openai", "name": "LiteLLM", "options": { "baseURL": "https://x.example.com/v1", "apiKey": "{env:LITELLM_DOCTOR_SECRET}" } } }
}`)
    // When: inspected and serialized
    const report = inspectOpenCodeConfig(path)
    const serialized = JSON.stringify(report)
    delete process.env.LITELLM_DOCTOR_SECRET

    // Then: the secret never leaks into the structured report
    expect(serialized).not.toContain('sk-should-never-appear')
  })

  test('json report entries contain only status, code, message, and path', () => {
    // Given: a valid config
    const path = writeConfig(`{
  "plugin": ["${PLUGIN_SPEC}"],
  "provider": { "litellm": { "npm": "@ai-sdk/openai", "name": "LiteLLM", "options": { "baseURL": "https://x.example.com/v1", "apiKey": "{env:K}" } } }
}`)
    // When: inspected
    const report = inspectOpenCodeConfig(path)

    // Then: each check only exposes the machine-readable fields
    for (const check of report.checks) {
      expect(Object.keys(check).sort()).toEqual(['code', 'message', 'path', 'status'])
    }
  })
})
