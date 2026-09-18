import { describe, expect, test } from 'bun:test'
import { AutoRouterMode } from '../src/cli/auto-router-contracts'
import { CodexMode, InstallAuth, InstallTarget } from '../src/cli/install-intent'
import { runInstallOnboarding, OnboardingResourceAccess, type OnboardingInput } from '../src/cli/onboarding'
import { resourcesForOnboarding } from '../src/cli/install-preparation-selection'
import { DISCOVERY, installOptions } from './install-preparation-test-support'

const INPUT: OnboardingInput = {
  defaultTarget: InstallTarget.Codex,
  defaultGatewayOrigin: 'https://independent.example.test',
  defaultAuth: InstallAuth.Environment,
  defaultCodexMode: CodexMode.HybridClient,
  autoRouterMode: AutoRouterMode.Skip,
  searchTools: [], mcpServers: [], mcpToolsets: [],
  models: [
    { name: 'team-fast', access: OnboardingResourceAccess.Available },
    { name: 'team-strong', access: OnboardingResourceAccess.Available },
    { name: 'restricted', access: OnboardingResourceAccess.Unavailable },
  ],
}

function scriptedIO(answers: readonly string[]) {
  const remaining = [...answers]
  return {
    isTTY: true,
    prompt: async () => {
      const answer = remaining.shift()
      if (answer === undefined) throw new Error('Unexpected extra prompt')
      return answer
    },
    write: (_message: string) => {},
  }
}

describe('hybrid onboarding', () => {
  for (const mode of [CodexMode.HybridClient, CodexMode.HybridServer]) {
    test(`${mode} requires an explicit available paid model before confirmation`, async () => {
      const result = await runInstallOnboarding({ ...INPUT, defaultCodexMode: mode },
        scriptedIO(['', '', '', '', '', 'restricted', '2', 'y']))
      expect(result).toMatchObject({ ok: true, plan: { codexFallbackModel: 'team-strong' } })
      if (result.ok) expect(result.plan.defaultModel).toBeUndefined()
    })
  }

  test('preserves an explicit authorized fallback without choosing another', async () => {
    const result = await runInstallOnboarding({ ...INPUT, codexFallbackModel: 'team-fast' },
      scriptedIO(['', '', '', '', 'y']))
    expect(result).toMatchObject({ ok: true, plan: { codexFallbackModel: 'team-fast' } })
  })

  test('rejects an unavailable explicit fallback before confirmation', async () => {
    const result = await runInstallOnboarding({ ...INPUT, codexFallbackModel: 'restricted' },
      scriptedIO(['', '', '', '']))
    expect(result).toMatchObject({ ok: false, failure: { code: 'invalid-fallback-model' } })
  })

  test('fails clearly if no paid chat model is available', async () => {
    const result = await runInstallOnboarding({ ...INPUT, models: [] }, scriptedIO(['', '', '', '']))
    expect(result).toMatchObject({ ok: false, failure: { code: 'invalid-fallback-model' } })
  })

  test('declining confirmation returns no install plan', async () => {
    const result = await runInstallOnboarding(INPUT, scriptedIO(['', '', '', '', '1', 'n']))
    expect(result).toMatchObject({ ok: false, failure: { code: 'cancelled' } })
  })

  test('offers arbitrary chat aliases but excludes known non-chat models', () => {
    const resources = resourcesForOnboarding({ ...DISCOVERY, models: [
      { id: 'team-strong', mode: 'chat' },
      { id: 'another-company-alias' },
      { id: 'embedding-prod', mode: 'embedding' },
      { id: 'art', mode: 'image_generation' },
      { id: 'voice', mode: 'audio' },
    ] }, installOptions())
    expect(resources.models?.map((model) => model.name)).toEqual(['team-strong', 'another-company-alias'])
  })
})
