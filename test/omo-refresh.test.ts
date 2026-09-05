import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { refreshOmoProfile } from '../src/omo/refresh'
import { setupProgramHome } from './cli-program-test-support'

let home = ''
setupProgramHome('omo-policy-refresh-', (path) => { home = path })

test('two authenticated refreshes use latest authorized server policy and preserve local customization on failure', async () => {
  let model = 'gpt-5.6-luna'
  let status = 200
  const path = join(home, 'oh-my-openagent.json')
  writeFileSync(path, JSON.stringify({ agents: { explore: { model: 'litellm/old', temperature: 0.2, fallback_models: ['alibaba/retired'] } } }))
  const server = Bun.serve({ port: 0, fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer fixture-key')
    if (new URL(request.url).pathname === '/v1/models') return Response.json({ data: ['student-auto','gpt-5.6-luna','gpt-5.6-terra'].map(id => ({id})) })
    expect(new URL(request.url).searchParams.get('include_team_models')).toBe('true')
    return Response.json({ data: [{ model_name: 'student-auto', model_info: { metadata: { omo: { version:1, agents: { explore:{model, fallback_models:[]} }, categories:{} } } } }] }, {status})
  } })
  const input = { configPath:join(home, 'opencode.json'), baseURL:server.url.origin, apiKey:'fixture-key', now: () => new Date(0) }
  try {
    await refreshOmoProfile(input)
    expect(parse(readFileSync(path,'utf8')).agents.explore).toEqual({model:'litellm/gpt-5.6-luna',temperature:0.2,fallback_models:['litellm/gpt-5.6-luna']})
    model = 'gpt-5.6-terra'
    await refreshOmoProfile(input)
    expect(parse(readFileSync(path,'utf8')).agents.explore.model).toBe('litellm/gpt-5.6-terra')
    const prior = readFileSync(path,'utf8')
    for (const rejected of [401,403,503]) {
      status=rejected
      await expect(refreshOmoProfile(input)).rejects.toThrow()
      expect(readFileSync(path,'utf8')).toBe(prior)
    }
    status=200
    model='private-not-authorized'
    await expect(refreshOmoProfile(input)).rejects.toThrow()
    expect(readFileSync(path,'utf8')).toBe(prior)
  } finally { server.stop(true) }
})
