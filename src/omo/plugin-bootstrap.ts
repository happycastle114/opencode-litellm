import { parse, type ParseError } from 'jsonc-parser'
import { normalizeCliEnvironment } from '../cli/environment'
import { readManagedTextFile } from '../cli/managed-file-safety'
import { resolveOpenCodeConfigPath } from '../cli/paths'
import { PROVIDER_RESOLUTION, resolveProvider } from '../plugin/provider-resolution'
import { isRecord, OmoPolicyError } from './policy'
import { refreshOmoProfile } from './refresh'

/** Read the managed source directly: requesting OpenCode config during startup can re-enter initialization. */
export async function bootstrapOmoPolicy(input: object): Promise<void> {
  if (!isRecord(input) || typeof input.directory !== 'string') return
  try {
    const env = normalizeCliEnvironment(process.env)
    const configPath = resolveOpenCodeConfigPath(env.OPENCODE_CONFIG, env)
    const profileConfigPath = resolveOpenCodeConfigPath(undefined, env)
    const errors: ParseError[] = []
    const config: unknown = parse(readManagedTextFile(configPath, '{}'), errors, { allowTrailingComma: true })
    if (errors.length > 0 || !isRecord(config)) throw new OmoPolicyError('Managed OpenCode configuration is not valid JSONC.')
    if (!isRecord(config.provider) || !isRecord(config.provider.litellm)) return
    const resolution = await resolveProvider(config, { allowAmbientFallback: false })
    if (resolution.kind !== PROVIDER_RESOLUTION.Resolved || resolution.apiKey === undefined) return
    await refreshOmoProfile({ configPath: profileConfigPath, baseURL: resolution.baseURL, apiKey: resolution.apiKey,
      customHeaders: resolution.customHeaders, now: () => new Date(),
    })
  } catch {
    console.warn('[opencode-litellm] OMO policy refresh failed; the existing profile was preserved. Check gateway access and policy metadata.')
  }
}
