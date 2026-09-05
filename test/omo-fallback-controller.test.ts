import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { parse } from 'jsonc-parser'
import { renderOmoPolicy } from '../src/omo/profile'

const functions = [
  'normalizeFallbackModels','buildFallbackChainFromModels','parseFallbackModelEntry','parseFallbackModelObjectEntry',
  'parseVariantFromModel','parseVariantFromModelID','parseModelString',
  'applyUserConfiguredFallbackChain','canonicalizeModelIDForDuplicateCheck','isSameFailedModel',
  'createModelFallbackStateController','canonicalizeModelID','createReachabilityChecker','getNextReachableFallback',
  'selectFallbackProviderWithCache','selectFallbackProvider','transformModelForProvider','transformModelForProviderUsingAnthropicBehavior',
  'stringifyRuntimeFallbackModel','createFallbackState','findNextAvailableFallback','isModelInCooldown','areRuntimeFallbackModelsEquivalent',
  'parseCanonicalRuntimeFallbackModel','canonicalizeRuntimeFallbackModelID','canonicalizeRuntimeFallbackProviderFamily',
]
const variables = ['AGENT_MODEL_REQUIREMENTS','stringifyRuntimeModel']

test.skipIf(process.env.OPENCODE_BINARY_TESTS !== '1')('real OMO error controllers cannot escape a rendered primary-only managed fallback', () => {
  const path = process.env.OMO_NATIVE_PLUGIN_PATH
  if (path === undefined) throw new Error('OMO_NATIVE_PLUGIN_PATH is required for pinned OMO controller QA')
  const source = readFileSync(path, 'utf8')
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const chunks: string[] = []
  const found = new Set<string>()
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && functions.includes(statement.name.text)) {
      chunks.push(statement.getText(tree)); found.add(statement.name.text)
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(tree)
      if (variables.includes(name)) { chunks.push(`var ${declaration.getText(tree)};`); found.add(name) }
    }
  }
  expect(found.size).toBe(functions.length + variables.length)
  const config = parse(renderOmoPolicy('{"agents":{"explore":{"model":"litellm/old"},"custom":{"model":"openai/private","fallback_models":["anthropic/custom"]}}}', {
    version:1,agents:{explore:{model:'gpt-5.6-luna',fallback_models:[]}},categories:{},
  }))
  expect(config.agents.custom).toEqual({model:'openai/private',fallback_models:['anthropic/custom']})
  const connected = ['litellm','openai']
  const context = createContext({ Map, Set, raw: [], rendered: config.agents.explore.fallback_models,
    log2() {}, HOOK_NAME12:'fixture', getAgentConfigKey:(name:string)=>name,
    readProviderModelsCache:()=>({connected}),readConnectedProvidersCache:()=>connected,
    exports_connected_providers_cache:{readConnectedProvidersCache:()=>connected},
  })
  runInContext(chunks.join('\n'), context)
  const result: unknown = runInContext(`
    function getRawFallbackModels() { return raw }
    function setSessionFallbackChain(controller,id,chain) { controller.setSessionFallbackChain(id,chain) }
    function onFailure(chain) {
      raw=chain;
      const controller=createModelFallbackStateController({pendingModelFallbacks:new Map,lastToastKey:new Map,sessionFallbackChains:new Map});
      applyUserConfiguredFallbackChain(controller,'fixture','explore','litellm',{});
      controller.setPendingModelFallback('fixture','explore','litellm','gpt-5.6-luna');
      return controller.getNextFallback('fixture');
    }
    ({legacy:onFailure([]),managed:onFailure(rendered),runtime:findNextAvailableFallback(createFallbackState('litellm/gpt-5.6-luna'),rendered,60)})
  `, context)
  expect(result).toEqual({legacy:{providerID:'openai',modelID:'gpt-5.4-mini-fast',variant:undefined,reasoningEffort:undefined,temperature:undefined,top_p:undefined,maxTokens:undefined,thinking:undefined},managed:null,runtime:undefined})
})
