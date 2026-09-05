import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupProgramHome } from './cli-program-test-support'

const RUN_NATIVE = process.env.OPENCODE_BINARY_TESTS === '1'
let home = ''
setupProgramHome('omo-native-policy-', (path) => { home = path })

test.skipIf(!RUN_NATIVE)('direct OpenCode initializes real OMO after current server assignments, preserving profile on discovery failure', async () => {
  const binary = Bun.which('opencode')
  const omo = process.env.OMO_NATIVE_PLUGIN_PATH
  const plugin = resolve(process.env.LITELLM_NATIVE_PLUGIN_PATH ?? 'dist/index.mjs')
  if (binary === null || omo === undefined) throw new Error('Native QA requires opencode on PATH and OMO_NATIVE_PLUGIN_PATH pointing to OMO 4.19.4 dist/index.js')
  const configDir = join(home, 'config', 'opencode')
  const workspace = join(home, 'workspace')
  const bin = join(home, 'bin')
  for (const path of [configDir, workspace, bin]) mkdirSync(path, { recursive: true })
  const helperMarker = join(home, 'helper-called')
  for (const name of ['security', 'gh', 'claude']) {
    const helper = join(bin, name)
    writeFileSync(helper, `#!/bin/sh\nprintf blocked > "${helperMarker}"\nexit 91\n`)
    chmodSync(helper, 0o700)
  }
  let model = 'gpt-5.6-luna'
  let status = 200
  let policyReads = 0
  const server = Bun.serve({ port: 0, fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer fixture-key')
    if (new URL(request.url).pathname === '/model/info') {
      policyReads += 1
      return Response.json({data:[{model_name:'student-auto',model_info:{metadata:{omo:{version:1,
        agents:{explore:{model,fallback_models:[]}},categories:{}}}}}]}, {status})
    }
    return Response.json({data:['student-auto','gpt-5.6-luna','gpt-5.6-terra','gpt-6-astra'].map(id=>({id,model_group:id,mode:'responses'}))})
  } })
  const profile = join(configDir, 'oh-my-openagent.json')
  writeFileSync(profile, JSON.stringify({agents:{explore:{model:'litellm/retired',temperature:0.2,fallback_models:['alibaba/old']}},disabled_mcps:['websearch','context7','grep']}))
  writeFileSync(join(configDir,'opencode.jsonc'), JSON.stringify({plugin:[pathToFileURL(plugin).href,pathToFileURL(omo).href],
    provider:{litellm:{npm:'@ai-sdk/openai',options:{baseURL:server.url.origin+'/v1',apiKey:'fixture-key'},models:{}}}}))
  const launch = async () => {
    const child = Bun.spawn([binary,'debug','agent','explore'], {cwd:workspace, env:{
      PATH:`${bin}${delimiter}${process.env.PATH ?? ''}`,HOME:home,XDG_CONFIG_HOME:join(home,'config'),OPENCODE_CONFIG_DIR:configDir,
      XDG_DATA_HOME:join(home,'data'),XDG_STATE_HOME:join(home,'state'),XDG_CACHE_HOME:join(home,'cache'),
      OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
    },stdout:'pipe',stderr:'pipe'})
    const timeout = setTimeout(() => child.kill(), 60_000)
    try {
      const [stdout,stderr] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()])
      expect({code:await child.exited,stderr}).toEqual({code:0,stderr: status === 200 ? '' : expect.stringContaining('OMO policy refresh failed')})
      return JSON.parse(stdout.slice(stdout.indexOf('{')))
    } finally {clearTimeout(timeout)}
  }
  try {
    for (const selected of ['gpt-5.6-luna','gpt-5.6-terra']) {
      model = selected
      const effective = await launch()
      expect(effective.model).toEqual({providerID:'litellm',modelID:selected})
      expect(effective.temperature).toBe(0.2)
      expect(JSON.parse(readFileSync(profile,'utf8')).agents.explore.fallback_models).toEqual([`litellm/${selected}`])
    }
    const prior = readFileSync(profile,'utf8')
    for (const failure of [401,503]) {
      status = failure
      expect((await launch()).model.modelID).toBe('gpt-5.6-terra')
      expect(readFileSync(profile,'utf8')).toBe(prior)
    }
    expect(policyReads).toBe(4)
    expect(existsSync(helperMarker)).toBe(false)
  } finally {server.stop(true)}
}, 180_000)
