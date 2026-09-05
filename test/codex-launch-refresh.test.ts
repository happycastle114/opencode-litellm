import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { runCliProgram } from '../src/cli/program'
import { bundledCodexCatalogBoundary, DISCOVERY, setupProgramHome } from './cli-program-test-support'

let home = ''
setupProgramHome('codex-launch-refresh-', (path) => { home = path })

test('each Codex launch replaces revoked models before spawning and preserves other settings', async () => {
  let models = [{ id: 'gpt-6-astra' }, { id: 'retired-model' }]
  let requests = 0
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/v1/models') {
      requests += 1
      expect(request.headers.get('authorization')).toBe('Bearer runtime-key')
      return Response.json({ data: models })
    }
    return Response.json({ data: [] })
  } })
  try {
    const context = { env: { HOME: home, LITELLM_PROXY_API_KEY: 'runtime-key' }, now: () => new Date(0) }
    const installed = await runCliProgram(['install', '--target', 'codex', '--codex-mode', 'gateway',
      '--base-url', server.url.origin, '--non-interactive'], {
      ...context, gatewayDiscovery: async () => DISCOVERY, codexSpawnBoundary: bundledCodexCatalogBoundary(),
    })
    expect(installed.exitCode).toBe(0)
    const configPath = join(home, '.codex', 'config.toml')
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n[notice]\nhide_rate_limit_model_nudge = true\n`)
    const snapshots: string[][] = []
    const launchContext = { ...context, agentLaunchBoundary: {
      which: (command: string) => command,
      spawn: () => {
        const config = parse(readFileSync(configPath, 'utf8'))
        const catalogPath = config.model_catalog_json
        if (typeof catalogPath !== 'string') throw new Error('missing catalog path')
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
        snapshots.push(catalog.models.map((model: { readonly slug: string }) => model.slug))
        return { status: 0, signal: null }
      },
    } }
    expect((await runCliProgram(['codex', 'exec', 'first'], launchContext)).exitCode).toBe(0)
    models = ['student-auto', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'].map((id) => ({ id }))
    expect((await runCliProgram(['codex', 'exec', 'second'], launchContext)).exitCode).toBe(0)
    expect(requests).toBe(2)
    expect(snapshots[0]).toContain('retired-model')
    expect(snapshots[1]).not.toContain('retired-model')
    expect(snapshots[1]).toContain('student-auto')
    expect(parse(readFileSync(configPath, 'utf8')).model).toBe('gpt-6-astra')
    expect(readFileSync(configPath, 'utf8')).toContain('hide_rate_limit_model_nudge = true')
  } finally { server.stop(true) }
})

test('will not overwrite an unrelated catalog path', async () => {
  const context = { env: { HOME: home, LITELLM_PROXY_API_KEY: 'runtime-key' }, now: () => new Date(0) }
  await runCliProgram(['install', '--target', 'codex', '--codex-mode', 'gateway',
    '--base-url', 'https://example.test', '--non-interactive'], {
    ...context, gatewayDiscovery: async () => DISCOVERY, codexSpawnBoundary: bundledCodexCatalogBoundary(),
  })
  const configPath = join(home, '.codex', 'config.toml')
  const unrelated = join(home, 'unrelated.json')
  writeFileSync(unrelated, 'keep this')
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(
    /^model_catalog_json = .*$/m, `model_catalog_json = ${JSON.stringify(unrelated)}`,
  ))
  let spawned = false
  const result = await runCliProgram(['codex', 'exec', 'test'], { ...context,
    agentLaunchBoundary: { which: (command) => command, spawn: () => {
      spawned = true
      return { status: 0, signal: null }
    } },
  })
  expect(result.exitCode).toBe(1)
  expect(spawned).toBe(false)
  expect(readFileSync(unrelated, 'utf8')).toBe('keep this')
})
