import { spawnSync } from 'node:child_process'

const CATALOG_FIELD = {
  Models: 'models', Slug: 'slug', Visibility: 'visibility', SupportedInApi: 'supported_in_api',
  Priority: 'priority', BaseInstructions: 'base_instructions', ModelMessages: 'model_messages',
  InstructionsTemplate: 'instructions_template',
} as const
const CATALOG_VALUE = { Listed: 'list' } as const
const CODEX_COMMAND = { File: 'codex', Debug: 'debug', Models: 'models', Bundled: '--bundled' } as const

const REQUIRED_OAUTH_MODEL_SLUGS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const

export type CodexSpawnResult = {
  readonly status?: number | null
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly stdout?: string | Uint8Array | null
  readonly stderr?: string | Uint8Array | null
  readonly error?: unknown
}

export type CodexSpawnBoundary = {
  readonly spawn: (
    file: string,
    args: readonly string[],
    options?: Readonly<Record<string, unknown>>,
  ) => CodexSpawnResult
}

export type CodexModelTemplate = Readonly<Record<string, unknown>>

export type BundledCodexCatalog = {
  readonly json: string
  readonly defaultModel: string
  readonly template: CodexModelTemplate
}

export class CodexCatalogError extends Error {
  readonly name = 'CodexCatalogError'
}

export function readBundledCodexCatalog(
  boundary: CodexSpawnBoundary = defaultCodexSpawnBoundary(),
): BundledCodexCatalog {
  const args = [CODEX_COMMAND.Debug, CODEX_COMMAND.Models, CODEX_COMMAND.Bundled] as const
  let result: CodexSpawnResult
  try {
    result = boundary.spawn(CODEX_COMMAND.File, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new CodexCatalogError("The Codex CLI executable 'codex' was not found on PATH.")
  }
  if (result.error !== undefined) {
    throw new CodexCatalogError("The Codex CLI executable 'codex' was not found on PATH.")
  }
  const status = result.status ?? result.exitCode
  if ((status !== undefined && status !== 0) || (result.signal !== undefined && result.signal !== null)) {
    throw new CodexCatalogError('Codex bundled model catalog command failed.')
  }
  const stdout = toText(result.stdout)
  if (stdout.trim() === '') throw invalidCatalog()
  let payload: unknown
  try {
    payload = JSON.parse(stdout)
  } catch {
    throw invalidCatalog()
  }
  const models = readBundledModels(payload)
  const normalized = `${JSON.stringify(payload, null, 2)}\n`
  const template = chooseBundledTemplate(models)
  if (template === undefined || !hasPromptTemplate(template)) throw invalidCatalog()
  const defaultModel = template[CATALOG_FIELD.Slug]
  if (typeof defaultModel !== 'string') throw invalidCatalog()
  return { json: normalized, defaultModel, template }
}

export function assertBundledCodexOAuthCatalog(catalog: BundledCodexCatalog): void {
  const missing = missingBundledCodexOAuthModels(readCatalogModels(catalog.json))
  if (missing.length === 0) return
  throw new CodexCatalogError(
    `Codex bundled model catalog is missing required OAuth picker models: ${missing.join(', ')}. ` +
    'Upgrade Codex CLI to 0.144.0 or newer and retry.',
  )
}

function readCatalogModels(source: string): readonly unknown[] {
  try {
    const payload: unknown = JSON.parse(source)
    if (!isRecord(payload)) return []
    const models = payload[CATALOG_FIELD.Models]
    return Array.isArray(models) ? models : []
  } catch {
    return []
  }
}

export function missingBundledCodexOAuthModels(models: readonly unknown[]): readonly string[] {
  const compatibleSlugs = new Set(models.filter(isRecord).filter((model) =>
    model[CATALOG_FIELD.Visibility] === CATALOG_VALUE.Listed &&
    model[CATALOG_FIELD.SupportedInApi] === true &&
    hasPromptTemplate(model),
  ).map((model) => model[CATALOG_FIELD.Slug]).filter((slug): slug is string =>
    typeof slug === 'string',
  ))
  return REQUIRED_OAUTH_MODEL_SLUGS.filter((slug) => !compatibleSlugs.has(slug))
}

function readBundledModels(payload: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!isRecord(payload)) throw invalidCatalog()
  const modelsValue = payload[CATALOG_FIELD.Models]
  if (!Array.isArray(modelsValue) || modelsValue.length === 0 || modelsValue.some((model) => !isRecord(model))) {
    throw invalidCatalog()
  }
  const models = modelsValue.filter(isRecord)
  for (const model of models) {
    const slug = model[CATALOG_FIELD.Slug]
    if (typeof slug !== 'string' || slug.trim() === '') throw invalidCatalog()
  }
  return models
}

function chooseBundledTemplate(
  models: readonly Readonly<Record<string, unknown>>[],
): CodexModelTemplate | undefined {
  let selected: { template: CodexModelTemplate; priority: number } | undefined
  for (const model of models) {
    if (
      model[CATALOG_FIELD.Visibility] !== CATALOG_VALUE.Listed ||
      model[CATALOG_FIELD.SupportedInApi] !== true ||
      typeof model[CATALOG_FIELD.Priority] !== 'number' ||
      !Number.isFinite(model[CATALOG_FIELD.Priority])
    ) continue
    const priority = model[CATALOG_FIELD.Priority]
    if (typeof priority !== 'number') continue
    if (selected === undefined || priority < selected.priority) selected = { template: model, priority }
  }
  return selected?.template
}

function hasPromptTemplate(model: CodexModelTemplate): boolean {
  const baseInstructions = model[CATALOG_FIELD.BaseInstructions]
  const modelMessages = model[CATALOG_FIELD.ModelMessages]
  if (typeof baseInstructions !== 'string' || baseInstructions.trim() === '' || !isRecord(modelMessages)) {
    return false
  }
  const instructionsTemplate = modelMessages[CATALOG_FIELD.InstructionsTemplate]
  return typeof instructionsTemplate === 'string' && instructionsTemplate.trim() !== ''
}

function invalidCatalog(): CodexCatalogError {
  return new CodexCatalogError('Codex bundled model catalog output was invalid or empty.')
}

function defaultCodexSpawnBoundary(): CodexSpawnBoundary {
  return {
    spawn(file, args) {
      const result = spawnSync(file, [...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toText(value: string | Uint8Array | null | undefined): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return new TextDecoder().decode(value)
}
