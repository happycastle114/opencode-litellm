import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import { isRecord, OMO_POLICY, OmoPolicyError, type OmoPolicy } from './policy'

const FORMATTING = { insertSpaces: true, tabSize: 2 }

/** Change only server-owned routing fields; preserve JSONC and local non-model customization. */
export function renderOmoPolicy(source: string, policy: OmoPolicy): string {
  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(config)) throw new OmoPolicyError('OMO profile is not valid JSONC.')
  let updated = source
  for (const section of OMO_POLICY.Sections) {
    const current = config[section]
    if (current !== undefined && !isRecord(current)) throw new OmoPolicyError('OMO profile section must be an object.')
    for (const [name, assignment] of Object.entries(policy[section])) {
      const slot = isRecord(current) ? current[name] : undefined
      if (slot !== undefined && !isRecord(slot)) throw new OmoPolicyError('OMO profile slot must be an object.')
      if (isRecord(slot) && typeof slot.model === 'string' && !slot.model.startsWith(OMO_POLICY.ModelPrefix)) continue
      const fields = { model: `${OMO_POLICY.ModelPrefix}${assignment.model}`,
        fallback_models: assignment.fallback_models.map((id) => `${OMO_POLICY.ModelPrefix}${id}`),
        ...(assignment.variant === undefined ? {} : { variant: assignment.variant }),
        ...(assignment.reasoningEffort === undefined ? {} : { reasoningEffort: assignment.reasoningEffort }),
      }
      for (const [field, value] of Object.entries(fields)) {
        updated = applyEdits(updated, modify(updated, [section, name, field], value, { formattingOptions: FORMATTING }))
      }
    }
  }
  return updated
}
