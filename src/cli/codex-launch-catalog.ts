import { isAbsolute, resolve } from 'node:path'
import { resolveCodexCatalogPath } from './paths'
import { parse as parseToml } from 'smol-toml'
import { AgentLaunchError } from './agent-launch-contracts'
import { buildCodexCatalog } from './codex-catalog'
import {
  createCodexSpawnBoundary,
  readBundledCodexCatalog,
  type CodexSpawnBoundary,
} from './codex-bundled-catalog'
import { discoverCodexGatewayResources } from './codex-gateway-discovery'
import { writeConfigAtomic } from './file-adapter'
import { assertManagedRegularFileOrAbsent, readManagedTextFile } from './managed-file-safety'

export type CodexLaunchCatalogInput = {
  readonly configPath: string
  readonly gatewayOrigin: string
  readonly apiKey: string
  readonly now: () => Date
  readonly codexSpawnBoundary?: CodexSpawnBoundary
}

export async function refreshCodexLaunchCatalog(input: CodexLaunchCatalogInput): Promise<void> {
  const source = readManagedTextFile(input.configPath, '')
  const config = parseToml(source)
  const catalogPath = config.model_catalog_json
  if (typeof catalogPath !== 'string' || !isAbsolute(catalogPath) ||
    resolve(catalogPath) !== resolveCodexCatalogPath(input.configPath)) {
    throw new AgentLaunchError('The installed Codex gateway catalog path is missing or invalid; reinstall Codex LiteLLM.')
  }
  assertManagedRegularFileOrAbsent(catalogPath)
  const discovered = await discoverCodexGatewayResources({ origin: input.gatewayOrigin, apiKey: input.apiKey })
  const bundled = readBundledCodexCatalog(input.codexSpawnBoundary ?? createCodexSpawnBoundary())
  const selected = typeof config.model === 'string' ? config.model : undefined
  const catalog = buildCodexCatalog(discovered.models, bundled, selected)
  if (readManagedTextFile(input.configPath, '') !== source) {
    throw new AgentLaunchError('Codex configuration changed during model refresh; retry the launch.')
  }
  assertManagedRegularFileOrAbsent(catalogPath)
  writeConfigAtomic(catalogPath, catalog.json, input)
  if (catalog.defaultModel !== selected) {
    writeConfigAtomic(input.configPath, replaceRootModel(source, catalog.defaultModel), input)
  }
}

function replaceRootModel(source: string, model: string): string {
  const tableStart = source.search(/^\s*\[/m)
  const end = tableStart < 0 ? source.length : tableStart
  const root = source.slice(0, end)
  const assignment = `model = ${JSON.stringify(model)}`
  const updatedRoot = /^\s*model\s*=/m.test(root)
    ? root.replace(/^\s*model\s*=.*$/m, assignment)
    : `${assignment}\n${root}`
  const updated = updatedRoot + source.slice(end)
  parseToml(updated)
  return updated
}
