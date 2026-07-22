import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CLIENT_INSTALL_ASSET_OPERATION } from '../src/cli/client-install-assets'
import { prepareCodexInstall } from '../src/cli/client-installer-codex-plan'
import { readBundledCodexCatalog } from '../src/cli/codex-discovery'
import type { PreparedInstall } from '../src/cli/install-preparation'
import { CodexMode, InstallAuth, InstallTarget, ToolkitDefault } from '../src/cli/install-intent'

const HOME_DIRECTORY = '/home/codex-catalog-inheritance'
const bundledCatalog = readBundledCodexCatalog({
  spawn: () => ({
    status: 0,
    stdout: readFileSync(
      new URL('./fixtures/codex-bundled-catalog-0.144.1.json', import.meta.url),
      'utf8',
    ),
    stderr: '',
  }),
})

describe('Codex install catalog inheritance', () => {
  test.each([CodexMode.Gateway, CodexMode.Both])(
    'inherits the bundled prompt template in %s mode',
    (codexMode) => {
      // Given: a gateway install and a validated current bundled Codex template
      const prepared = preparedInstall(codexMode)

      // When: the installer plans the managed catalog assets
      const plan = prepareCodexInstall(prepared, {
        env: { HOME: HOME_DIRECTORY },
        bundledCodexCatalog: () => bundledCatalog,
      }, HOME_DIRECTORY)
      const asset = plan.assets.find(({ path }) => path.endsWith('litellm-models.json'))
      expect(asset).toBeDefined()
      if (asset === undefined || asset.operation !== CLIENT_INSTALL_ASSET_OPERATION.Write) return
      const model = JSON.parse(asset.contents).models[0]

      // Then: the gateway row uses Codex prompt/tool behavior, not local prompt prose
      expect(model.base_instructions).toBe(bundledCatalog.template.base_instructions)
      expect(model.model_messages).toEqual(bundledCatalog.template.model_messages)
      expect(model.include_skills_usage_instructions).toBe(
        bundledCatalog.template.include_skills_usage_instructions,
      )
      expect(model.comp_hash).toBe(bundledCatalog.template.comp_hash)
    },
  )

  test.each([CodexMode.OAuth, CodexMode.Both])(
    'writes the bundled OAuth catalog unchanged in %s mode',
    (codexMode) => {
      // Given: an OAuth-capable install and exact bundled catalog bytes
      const prepared = preparedInstall(codexMode)

      // When: the installer plans the OAuth catalog asset
      const plan = prepareCodexInstall(prepared, {
        env: { HOME: HOME_DIRECTORY },
        bundledCodexCatalog: () => bundledCatalog,
      }, HOME_DIRECTORY)
      const asset = plan.assets.find(
        ({ path }) => path.endsWith('litellm-codex-oauth-models.json'),
      )
      expect(asset).toBeDefined()
      if (asset === undefined || asset.operation !== CLIENT_INSTALL_ASSET_OPERATION.Write) return

      // Then: no gateway transformation touches the OAuth catalog
      expect(asset.contents).toBe(bundledCatalog.json)
    },
  )

  test.each([CodexMode.OAuth, CodexMode.Both])(
    'fails %s planning before writes when the installed Codex catalog is too old',
    (codexMode) => {
      const outdated = readBundledCodexCatalog({
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify({
            models: [{
              slug: 'gpt-5.5',
              visibility: 'list',
              supported_in_api: true,
              priority: 1,
              base_instructions: 'fixture-base',
              model_messages: { instructions_template: 'fixture-template' },
            }],
          }),
          stderr: '',
        }),
      })

      expect(() => prepareCodexInstall(preparedInstall(codexMode), {
        env: { HOME: HOME_DIRECTORY },
        bundledCodexCatalog: () => outdated,
      }, HOME_DIRECTORY)).toThrow(/upgrade codex cli/i)
    },
  )
})

function preparedInstall(codexMode: CodexMode): PreparedInstall {
  return {
    options: {
      target: InstallTarget.Codex,
      baseUrl: 'https://gateway.example.test',
      auth: InstallAuth.Sso,
      authEnv: 'LITELLM_PROXY_API_KEY',
      nonInteractive: true,
      opencodeConfig: undefined,
      codexConfig: undefined,
      codexMode,
      autoRouter: ToolkitDefault.NonInteractiveAutoRouter,
      search: [],
      mcp: [],
      toolsets: [],
      enableMcp: [],
      disableMcp: [],
      noSearch: true,
      noMcp: true,
      noToolsets: true,
    },
    apiKey: 'fixture-api-key',
    discovery: {
      models: [{ id: 'gateway-model' }],
      searchToolNames: [],
      mcpServerNames: [],
      toolsets: [],
      warnings: [],
    },
    selectionWarnings: [],
  }
}
