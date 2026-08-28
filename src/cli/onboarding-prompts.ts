export const OnboardingResourceAccess = {
  Available: 'available',
  Unavailable: 'unavailable',
} as const
export type OnboardingResourceAccess =
  (typeof OnboardingResourceAccess)[keyof typeof OnboardingResourceAccess]

export type OnboardingResource = {
  readonly name: string
  readonly access: OnboardingResourceAccess
}

export interface OnboardingIO {
  readonly isTTY: boolean
  readonly prompt: (message: string) => Promise<string>
  readonly write: (message: string) => void
}

export type NumberedChoice<Value extends string> = {
  readonly label: string
  readonly value: Value
}

type SingleSelectionRequest<Value extends string> = {
  readonly io: OnboardingIO
  readonly title: string
  readonly prompt: string
  readonly choices: readonly NumberedChoice<Value>[]
  readonly defaultValue: Value
}

type ResourceSelectionRequest = {
  readonly io: OnboardingIO
  readonly title: string
  readonly resources: readonly OnboardingResource[]
}

export const OnboardingInputToken = { Default: '' } as const

const InputToken = {
  ...OnboardingInputToken,
  None: '0',
  Yes: 'y',
  YesLong: 'yes',
  No: 'n',
  NoLong: 'no',
} as const

const ESC = '\x1b['

const C = {
  bold: (s: string) => `${ESC}1m${s}${ESC}22m`,
  dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
  green: (s: string) => `${ESC}32m${s}${ESC}39m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}39m`,
  white: (s: string) => `${ESC}97m${s}${ESC}39m`,
  bgCyan: (s: string) => `${ESC}46m${ESC}30m${s}${ESC}49m${ESC}39m`,
} as const

export function renderBanner(): string {
  const title = 'LiteLLM Toolkit'
  const subtitle = 'Connect OpenCode, Codex, and Claude Code to your gateway'
  return [
    '',
    C.bgCyan(`  ${title}  `),
    C.dim(`  ${subtitle}`),
    '',
  ].join('\n')
}

export function renderStep(title: string): string {
  return `\n${C.bold(C.cyan(`  ${title}`))}\n${C.dim('  ─────────────────────────────────────────')}`
}

export function renderSummary(lines: readonly (readonly [string, string])[]): string {
  const maxLabel = Math.max(...lines.map(([label]) => label.length))
  const body = lines.map(([label, value]) =>
    `  ${C.dim(label.padEnd(maxLabel, ' '))}  ${C.white(value)}`,
  )
  return body.join('\n')
}

export function renderWarning(message: string): string {
  return `${C.yellow('  ⚠ ')}${message}`
}

const PromptText = {
  MultiPrompt: `${C.dim('comma-separated numbers, 0=none, Enter=all')}`,
  DefaultMarker: ` ${C.green('← default')}`,
  InvalidNumber: `${C.yellow('  ⚠ Please enter one of the listed numbers.')}`,
  InvalidMulti: `${C.yellow('  ⚠ Enter unique numbers separated by commas, 0, or Enter.')}`,
  InvalidConfirmation: `${C.yellow('  ⚠ Please enter y or n.')}`,
  Arrow: `${C.cyan('▸')}`,
} as const

const DECIMAL_PATTERN = /^[1-9]\d*$/

const CONFIRMATION_VALUES: ReadonlyMap<string, boolean> = new Map([
  [InputToken.Yes, true],
  [InputToken.YesLong, true],
  [InputToken.No, false],
  [InputToken.NoLong, false],
  [InputToken.Default, false],
])

export async function selectSingle<Value extends string>(
  request: SingleSelectionRequest<Value>,
): Promise<Value> {
  request.io.write(renderStep(request.title))
  const lines = request.choices.map(
    (choice, index) =>
      `  ${C.cyan(`${index + 1}.`)} ${choice.label}${choice.value === request.defaultValue ? PromptText.DefaultMarker : ''}`,
  )
  request.io.write(lines.join('\n'))
  while (true) {
    const raw = (await request.io.prompt(`${PromptText.Arrow} ${C.dim(request.prompt)} `)).trim()
    if (raw === InputToken.Default) return request.defaultValue
    const index = parseChoiceNumber(raw, request.choices.length)
    const choice = index === undefined ? undefined : request.choices[index - 1]
    if (choice !== undefined) return choice.value
    request.io.write(PromptText.InvalidNumber)
  }
}

export async function selectResources(
  request: ResourceSelectionRequest,
): Promise<readonly string[]> {
  const available = request.resources.filter(
    (resource) => resource.access === OnboardingResourceAccess.Available,
  )
  if (available.length === 0) return []

  request.io.write(renderStep(request.title))
  const lines = available.map((resource, index) => `  ${C.cyan(`${index + 1}.`)} ${resource.name}`)
  request.io.write(lines.join('\n'))
  while (true) {
    const raw = (await request.io.prompt(`${PromptText.Arrow} ${PromptText.MultiPrompt} `)).trim()
    if (raw === InputToken.Default) return available.map((resource) => resource.name)
    if (raw === InputToken.None) return []
    const indexes = parseMultipleChoiceNumbers(raw, available.length)
    if (indexes !== undefined) {
      const selected = new Set(indexes)
      return available
        .filter((_resource, index) => selected.has(index + 1))
        .map((resource) => resource.name)
    }
    request.io.write(PromptText.InvalidMulti)
  }
}

export async function confirm(io: OnboardingIO, prompt: string): Promise<boolean> {
  while (true) {
    const raw = (await io.prompt(`${PromptText.Arrow} ${C.bold(prompt)} ${C.dim('[y/N]')} `)).trim().toLowerCase()
    const confirmed = CONFIRMATION_VALUES.get(raw)
    if (confirmed !== undefined) return confirmed
    io.write(PromptText.InvalidConfirmation)
  }
}

function parseChoiceNumber(raw: string, choiceCount: number): number | undefined {
  if (!DECIMAL_PATTERN.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= choiceCount ? value : undefined
}

function parseMultipleChoiceNumbers(
  raw: string,
  choiceCount: number,
): readonly number[] | undefined {
  const tokens = raw.split(',').map((token) => token.trim())
  const selected = new Set<number>()
  for (const token of tokens) {
    const value = parseChoiceNumber(token, choiceCount)
    if (value === undefined || selected.has(value)) return undefined
    selected.add(value)
  }
  return [...selected]
}
