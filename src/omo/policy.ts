import { STUDENT_AUTO } from '../utils/student-catalog'

export const OMO_POLICY = {
  Version: 1,
  Sections: ['agents', 'categories'],
  Fields: ['model', 'fallback_models', 'variant', 'reasoningEffort'],
  Reasoning: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  ModelPrefix: 'litellm/',
} as const
export type OmoSection = typeof OMO_POLICY.Sections[number]
export type OmoAssignment = {
  readonly model: string
  readonly fallback_models: readonly string[]
  readonly variant?: string
  readonly reasoningEffort?: string
}
export type OmoPolicy = { readonly version: 1 } & Readonly<Record<OmoSection, Readonly<Record<string, OmoAssignment>>>>

export class OmoPolicyError extends Error {
  readonly name = 'OmoPolicyError'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseOmoPolicy(payload: unknown, authorizedIds: readonly string[]): OmoPolicy | undefined {
  const authorized = new Set(authorizedIds)
  if (!authorized.has(STUDENT_AUTO.Id)) return undefined
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new OmoPolicyError('Invalid LiteLLM model information response.')
  let result: OmoPolicy | undefined
  for (const row of payload.data) {
    if (!isRecord(row) || row.model_name !== STUDENT_AUTO.Id) continue
    const metadata = isRecord(row.model_info) ? row.model_info.metadata : undefined
    if (!isRecord(metadata) || metadata.omo === undefined) continue
    const policy = readPolicy(metadata.omo, authorized)
    if (result !== undefined && JSON.stringify(result) !== JSON.stringify(policy)) {
      throw new OmoPolicyError('Conflicting LiteLLM OMO policy roots.')
    }
    result = policy
  }
  return result
}

function readPolicy(value: unknown, authorized: ReadonlySet<string>): OmoPolicy {
  if (!isRecord(value) || value.version !== OMO_POLICY.Version) throw new OmoPolicyError('Unsupported LiteLLM OMO policy version.')
  return { version: OMO_POLICY.Version, agents: readSection(value.agents, authorized), categories: readSection(value.categories, authorized) }
}

function readSection(value: unknown, authorized: ReadonlySet<string>): Readonly<Record<string, OmoAssignment>> {
  if (!isRecord(value)) throw new OmoPolicyError('OMO policy sections must be objects.')
  const entries: [string, OmoAssignment][] = []
  for (const name of Object.keys(value).sort()) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new OmoPolicyError('Invalid OMO policy slot name.')
    const slot = value[name]
    if (!isRecord(slot) || Object.keys(slot).some((key) => !OMO_POLICY.Fields.some((field) => field === key)) ||
      typeof slot.model !== 'string' || !authorized.has(slot.model) || !Array.isArray(slot.fallback_models) ||
      !slot.fallback_models.every((model): model is string => typeof model === 'string' && authorized.has(model))) {
      throw new OmoPolicyError(`OMO policy slot '${name}' references invalid or unauthorized models.`)
    }
    if (slot.variant !== undefined && (typeof slot.variant !== 'string' || !/^[a-z][a-z0-9-]*$/.test(slot.variant))) {
      throw new OmoPolicyError(`OMO policy slot '${name}' has an invalid variant.`)
    }
    if (slot.reasoningEffort !== undefined && !OMO_POLICY.Reasoning.some((level) => level === slot.reasoningEffort)) {
      throw new OmoPolicyError(`OMO policy slot '${name}' has an invalid reasoning effort.`)
    }
    entries.push([name, { model: slot.model, fallback_models: [...new Set(slot.fallback_models)],
      ...(typeof slot.variant === 'string' ? { variant: slot.variant } : {}),
      ...(typeof slot.reasoningEffort === 'string' ? { reasoningEffort: slot.reasoningEffort } : {}),
    }])
  }
  return Object.fromEntries(entries)
}
