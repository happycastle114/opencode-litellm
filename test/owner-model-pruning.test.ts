import { expect, test } from 'bun:test'
import { discoverAndMergeModels } from '../src/plugin/model-discovery'

test('successful owner discovery removes retired LiteLLM aliases while preserving authorized custom metadata', async () => {
  let ids = ['gpt-5.6-sol','gpt-5.6-luna']
  const models: Record<string, unknown> = { retired: {name:'old'}, 'gpt-5.6-sol':{name:'My model'} }
  const server=Bun.serve({port:0,fetch(){return Response.json({data:ids.map(id=>({id,model_group:id}))})}})
  try {
    const config = {model:'litellm/retired'}
    const input={config,baseURL:server.url.origin,apiKey:'fixture',customHeaders:undefined,signal:AbortSignal.timeout(3000),models}
    await discoverAndMergeModels(input)
    expect(Object.keys(models).sort()).toEqual([...ids].sort())
    expect(config.model).toBe('litellm/gpt-5.6-luna')
    expect(models['gpt-5.6-sol']).toEqual({name:'My model'})
    models['openrouter-free/explicit'] = { name:'Explicit allowed child' }
    models['opencode-go/retired'] = { name:'Retired alias' }
    config.model='litellm/openrouter-free/explicit'
    ids=['gpt-5.6-sol','openrouter-free/*']
    await discoverAndMergeModels(input)
    expect(models['openrouter-free/explicit']).toEqual({name:'Explicit allowed child'})
    expect(models['opencode-go/retired']).toBeUndefined()
    expect(config.model).toBe('litellm/openrouter-free/explicit')
    config.model='openai/user-choice'
    await discoverAndMergeModels(input)
    expect(config.model).toBe('openai/user-choice')
    ids=[]
    await discoverAndMergeModels(input)
    expect(models['gpt-5.6-sol']).toEqual({name:'My model'})
    ids=['*']
    await discoverAndMergeModels(input)
    expect(models['gpt-5.6-sol']).toEqual({name:'My model'})
  } finally {server.stop(true)}
})
