import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { parse } from 'smol-toml'
import { runCliProgram } from '../src/cli/program'
import { bundledCodexCatalogBoundary, DISCOVERY, setupProgramHome } from './cli-program-test-support'

let home = ''
setupProgramHome('codex-launch-runtime-', (path) => { home = path })

test('built CLI refreshes between native child launches with USERPROFILE-only home and no credential helpers', async () => {
  let ids = ['old-permission']
  let status = 200
  let requests = 0
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/v1/models') {
      requests += 1
      return Response.json({ data: ids.map((id) => ({ id })) }, { status })
    }
    return Response.json({ data: [] })
  } })
  try {
    const installed = await runCliProgram(['install', '--target', 'codex', '--codex-mode', 'gateway',
      '--base-url', server.url.origin, '--non-interactive'], {
      env: { HOME: home, LITELLM_PROXY_API_KEY: 'fixture-key' }, now: () => new Date(0),
      gatewayDiscovery: async () => DISCOVERY, codexSpawnBoundary: bundledCodexCatalogBoundary(),
    })
    expect(installed.exitCode).toBe(0)
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const native = join(bin, 'native.cjs')
    writeFileSync(native, `const fs = require('node:fs');
const path = require('node:path');
const config = fs.readFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
const file = JSON.parse(config.match(/^model_catalog_json\\s*=\\s*(".*")/m)[1]);
const selected = JSON.parse(config.match(/^model\\s*=\\s*(".*")/m)[1]);
const models = JSON.parse(fs.readFileSync(file, 'utf8')).models.map(model => model.slug);
fs.appendFileSync(path.join(process.env.HOME, 'native.jsonl'), JSON.stringify({ models, selected, args: process.argv.slice(2) }) + '\\n');
`)
    const windows = process.platform === 'win32'
    const executable = join(bin, windows ? 'codex.cmd' : 'codex')
    writeFileSync(executable, windows
      ? `@echo off\r\n"${process.execPath}" "${native}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${native}" "$@"\n`)
    chmodSync(executable, 0o700)
    const helper = join(bin, windows ? 'security.cmd' : 'security')
    writeFileSync(helper, windows
      ? '@echo off\r\ntype nul > "%USERPROFILE%\\credential-helper-called"\r\nexit /b 91\r\n'
      : '#!/bin/sh\ntouch "$USERPROFILE/credential-helper-called"\nexit 91\n')
    chmodSync(helper, 0o700)
    const env = { ...process.env, HOME: undefined, USERPROFILE: home,
      LITELLM_PROXY_API_KEY: 'fixture-key', PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }
    const launch = async () => {
      const child = Bun.spawn([process.execPath, resolve('dist/opencode-litellm.mjs'), 'codex', 'exec', 'fixture'],
        { env, stdout: 'pipe', stderr: 'pipe' })
      const stderr = await new Response(child.stderr).text()
      return { exitCode: await child.exited, stderr }
    }
    expect((await launch()).exitCode).toBe(0)
    ids = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra']
    expect((await launch()).exitCode).toBe(0)
    const lines = readFileSync(join(home, 'native.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(lines[0].models).toEqual(['old-permission'])
    expect(lines[1].models.sort()).toEqual([...ids].sort())
    expect(lines[1].selected).toBe('student-auto')
    expect(lines[1].args).toEqual(['exec', 'fixture'])
    status = 503
    const fallback = await launch()
    expect(fallback.exitCode).toBe(0)
    expect(fallback.stderr).toContain('last validated Codex catalog')
    const snapshots = readFileSync(join(home, 'native.jsonl'), 'utf8')
    for (const rejected of [401, 403]) {
      status = rejected
      expect((await launch()).exitCode).toBe(1)
      expect(readFileSync(join(home, 'native.jsonl'), 'utf8')).toBe(snapshots)
    }
    status = 200
    ids = []
    expect((await launch()).exitCode).toBe(1)
    expect(readFileSync(join(home, 'native.jsonl'), 'utf8')).toBe(snapshots)
    const catalogPath = parse(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).model_catalog_json
    if (typeof catalogPath !== 'string') throw new Error('missing generated catalog path')
    writeFileSync(catalogPath, '{broken-json')
    status = 503
    expect((await launch()).exitCode).toBe(1)
    expect(readFileSync(join(home, 'native.jsonl'), 'utf8')).toBe(snapshots)
    expect(requests).toBe(7)
    expect(existsSync(join(home, '.litellm', 'token.json'))).toBe(false)
    expect(existsSync(join(home, 'credential-helper-called'))).toBe(false)
  } finally { server.stop(true) }
}, 30_000)
