import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type Edit,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'
import { dirname, join } from 'node:path'
import { ConfigurationError } from './errors'
import { managedPathEntryExists } from './managed-file-safety'

export const QWEN_GATEWAY_MODEL = 'alibaba-token/qwen3.8-max-preview' as const
export const QWEN_OPENCODE_MODEL = 'litellm/alibaba-token/qwen3.8-max-preview' as const

export const OH_MY_OPENAGENT_PROFILE_FILE = 'oh-my-openagent.json' as const
export const OH_MY_OPENAGENT_WEBSEARCH_MCP = 'websearch' as const

const OH_MY_OPENAGENT_PROFILE_CANDIDATES = [
  'oh-my-openagent.jsonc',
  OH_MY_OPENAGENT_PROFILE_FILE,
  'oh-my-opencode.jsonc',
  'oh-my-opencode.json',
] as const

const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2 }

const MANAGED_AGENTS = [
  'sisyphus-junior',
  'prometheus',
  'plan',
  'librarian',
  'explore',
  'document-writer',
  'multimodal-looker',
] as const

const MANAGED_CATEGORIES = [
  'writing',
  'long-context',
] as const

export type OhMyOpenAgentManagedSection = 'agents' | 'categories'

export type OhMyOpenAgentProfileIntent = {
  readonly qwenRoutingEnabled: boolean
}

export const OH_MY_OPENAGENT_MANAGED_AGENTS = MANAGED_AGENTS
export const OH_MY_OPENAGENT_MANAGED_CATEGORIES = MANAGED_CATEGORIES

export function resolveOhMyOpenAgentProfilePath(opencodeConfigPath: string): string {
  const candidates = resolveOhMyOpenAgentProfileCandidatePaths(opencodeConfigPath)
  for (const candidate of candidates) {
    if (managedPathEntryExists(candidate)) return candidate
  }
  return candidates[1]
}

export function resolveOhMyOpenAgentProfileCandidatePaths(
  opencodeConfigPath: string,
): readonly [string, string, string, string] {
  const configDirectory = dirname(opencodeConfigPath)
  return [
    join(configDirectory, OH_MY_OPENAGENT_PROFILE_CANDIDATES[0]),
    join(configDirectory, OH_MY_OPENAGENT_PROFILE_CANDIDATES[1]),
    join(configDirectory, OH_MY_OPENAGENT_PROFILE_CANDIDATES[2]),
    join(configDirectory, OH_MY_OPENAGENT_PROFILE_CANDIDATES[3]),
  ]
}

export function planQwenRoutingProfileEdits(
  source: string,
  path?: string,
): readonly Edit[] {
  return planOhMyOpenAgentProfileEdits(source, {
    qwenRoutingEnabled: true,
  }, path)
}

export function planOhMyOpenAgentProfileEdits(
  source: string,
  intent: OhMyOpenAgentProfileIntent,
  path?: string,
): readonly Edit[] {
  parseValidProfile(source, path)
  let updated = disableOpenAgentWebsearch(source, path)
  for (const name of MANAGED_AGENTS) {
    updated = intent.qwenRoutingEnabled
      ? setManagedModel(updated, 'agents', name)
      : clearStaleManagedModel(updated, 'agents', name)
  }
  for (const name of MANAGED_CATEGORIES) {
    updated = intent.qwenRoutingEnabled
      ? setManagedModel(updated, 'categories', name)
      : clearStaleManagedModel(updated, 'categories', name)
  }
  return updated === source
    ? []
    : [{ offset: 0, length: source.length, content: updated }]
}

export function renderQwenRoutingProfile(source: string, path?: string): string {
  return applyEdits(source, [...planQwenRoutingProfileEdits(source, path)])
}

export function renderOhMyOpenAgentProfile(
  source: string,
  intent: OhMyOpenAgentProfileIntent,
  path?: string,
): string {
  return applyEdits(source, [...planOhMyOpenAgentProfileEdits(source, intent, path)])
}

function disableOpenAgentWebsearch(source: string, path: string | undefined): string {
  const parsed: unknown = parseJsonc(source)
  const disabledMcps = isRecord(parsed) ? parsed.disabled_mcps : undefined
  if (disabledMcps === undefined) {
    return applyEdits(
      source,
      modify(source, ['disabled_mcps'], [OH_MY_OPENAGENT_WEBSEARCH_MCP], {
        formattingOptions: FORMATTING,
      }),
    )
  }
  if (!Array.isArray(disabledMcps)) {
    throw new ConfigurationError('Oh My OpenAgent disabled_mcps must be an array', path)
  }
  if (disabledMcps.includes(OH_MY_OPENAGENT_WEBSEARCH_MCP)) return source
  return applyEdits(
    source,
    modify(
      source,
      ['disabled_mcps', disabledMcps.length],
      OH_MY_OPENAGENT_WEBSEARCH_MCP,
      { formattingOptions: FORMATTING, isArrayInsertion: true },
    ),
  )
}

function setManagedModel(
  source: string,
  section: OhMyOpenAgentManagedSection,
  name: string,
): string {
  let updated = source
  const parsed: unknown = parseJsonc(updated)
  if (!isRecord(parsed) || !isRecord(parsed[section])) {
    updated = applyEdits(
      updated,
      modify(updated, [section], {}, { formattingOptions: FORMATTING }),
    )
  }
  const next: unknown = parseJsonc(updated)
  const sectionValue = isRecord(next) && isRecord(next[section])
    ? next[section]
    : undefined
  const entry = sectionValue?.[name]
  const entryPath = isRecord(entry)
    ? [section, name, 'model']
    : [section, name]
  const entryValue = isRecord(entry)
    ? QWEN_OPENCODE_MODEL
    : { model: QWEN_OPENCODE_MODEL }
  return applyEdits(
    updated,
    modify(updated, entryPath, entryValue, { formattingOptions: FORMATTING }),
  )
}

function clearStaleManagedModel(
  source: string,
  section: OhMyOpenAgentManagedSection,
  name: string,
): string {
  const parsed: unknown = parseJsonc(source)
  const sectionValue = isRecord(parsed) && isRecord(parsed[section])
    ? parsed[section]
    : undefined
  const entry = sectionValue?.[name]
  if (!isRecord(entry) || entry.model !== QWEN_OPENCODE_MODEL) return source
  return applyEdits(
    source,
    modify(source, [section, name, 'model'], undefined, {
      formattingOptions: FORMATTING,
    }),
  )
}

function parseValidProfile(source: string, path: string | undefined): void {
  const errors: ParseError[] = []
  const config = parseJsonc(source, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(config)) {
    throw new ConfigurationError('Oh My OpenAgent profile is not valid JSONC', path)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
