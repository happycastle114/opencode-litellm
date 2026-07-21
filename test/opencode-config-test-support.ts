import {
  OH_MY_OPENAGENT_PLUGIN_SPEC,
  planOpenCodeEdits,
  applyOpenCodeEdits,
} from '../src/cli/opencode-config'
import packageJson from '../package.json' with { type: 'json' }

export const PACKAGE_VERSION = packageJson.version
export const PLUGIN_SPEC = `opencode-plugin-litellm@${PACKAGE_VERSION}`
export const baseIntent = {
  baseUrl: 'https://litellm.example.com',
  authEnv: 'LITELLM_API_KEY',
  models: [],
  search: [],
  mcp: [],
  disableMcp: [],
} as const

export { OH_MY_OPENAGENT_PLUGIN_SPEC }

export function render(
  source: string,
  intent = baseIntent,
): string {
  const edits = planOpenCodeEdits(source, intent)
  return applyOpenCodeEdits(source, edits)
}
