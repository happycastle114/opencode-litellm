import { tool, type ToolDefinition } from '@opencode-ai/plugin'
import { version } from '../version'
import { normalizeBaseURL } from '../utils/litellm-api'
import { resolveHeaderSafeApiKey } from '../utils/api-key'
import {
  LiteLLMSearchError,
  type LiteLLMSearchEndpoint,
} from './client'

export const NATIVE_WEB_SEARCH_TOOL_NAME = 'web-search' as const

const MAX_OUTPUT_TOKENS = 16000
const SEARCH_INPUT_PREFIX = 'Perform a web search for the query: '
const SEARCH_INSTRUCTIONS = 'You are an assistant for performing a web search tool use'
const USER_AGENT = `opencode-litellm/${version}`

type NativeWebSearchHit = {
  readonly title: string
  readonly url: string
}

type NativeWebSearchResult = string | readonly NativeWebSearchHit[]

export type NativeWebSearchModel = {
  readonly modelID: string
  readonly providerID: string
}

type NativeWebSearchState = {
  readonly endpoint: LiteLLMSearchEndpoint | undefined
  readonly model: NativeWebSearchModel | undefined
}

type NativeWebSearchStateResolver = (sessionID: string) => NativeWebSearchState

export function createNativeWebSearchTool(
  resolveState: NativeWebSearchStateResolver,
): ToolDefinition {
  return tool({
    description: nativeWebSearchDescription(),
    args: {
      query: tool.schema.string().trim().min(2),
    },
    async execute(args, context) {
      const state = resolveState(context.sessionID)
      if (!state.endpoint) {
        throw new LiteLLMSearchError('LiteLLM search base URL is not configured')
      }
      if (!state.model) {
        throw new LiteLLMSearchError('No active LiteLLM model is available for web search')
      }

      const results = await nativeWebSearch({
        endpoint: state.endpoint,
        modelID: state.model.modelID,
        query: args.query,
        signal: context.abort,
      })
      const metadata = { resultCount: results.length }
      context.metadata({ title: `Web search: ${args.query}`, metadata })
      return {
        output: JSON.stringify({ query: args.query, results }, null, 2),
        metadata,
      }
    },
  })
}

type NativeWebSearchInvocation = {
  readonly endpoint: LiteLLMSearchEndpoint
  readonly modelID: string
  readonly query: string
  readonly signal: AbortSignal
}

export async function nativeWebSearch(
  invocation: NativeWebSearchInvocation,
): Promise<readonly NativeWebSearchResult[]> {
  const apiKey = resolveHeaderSafeApiKey(invocation.endpoint.apiKey)
  if (apiKey === undefined) {
    throw new LiteLLMSearchError('LiteLLM search API key is not configured')
  }

  const headers = new Headers(invocation.endpoint.customHeaders)
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Content-Type', 'application/json')
  headers.set('User-Agent', USER_AGENT)

  let response: Response
  try {
    response = await fetch(
      `${normalizeBaseURL(invocation.endpoint.baseURL)}/v1/responses`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: `${SEARCH_INPUT_PREFIX}${invocation.query}`,
          instructions: SEARCH_INSTRUCTIONS,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          model: invocation.modelID,
          tools: [{ type: 'web_search' }],
        }),
        signal: invocation.signal,
      },
    )
  } catch (error) {
    if (
      invocation.signal.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw new LiteLLMSearchError('LiteLLM web search request was aborted')
    }
    throw new LiteLLMSearchError('LiteLLM web search network request failed')
  }

  if (!response.ok) {
    throw new LiteLLMSearchError(
      `LiteLLM web search responded with HTTP ${response.status}`,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new LiteLLMSearchError('LiteLLM web search returned malformed JSON')
  }
  return parseResponse(raw)
}

function parseResponse(value: unknown): readonly NativeWebSearchResult[] {
  if (!isRecord(value)) {
    throw new LiteLLMSearchError('LiteLLM web search returned a malformed response')
  }

  const output = Array.isArray(value.output) ? value.output : []
  const outputText = resolveOutputText(value.output_text, output)
  const hits = collectUniqueCitationHits(output)
  const results: NativeWebSearchResult[] = []
  if (outputText !== undefined) results.push(outputText)
  if (hits.length > 0) results.push(hits)
  if (results.length === 0) {
    throw new LiteLLMSearchError('LiteLLM web search returned no search results')
  }
  return results
}

function resolveOutputText(
  directOutput: unknown,
  output: readonly unknown[],
): string | undefined {
  const directText = readNonEmptyString(directOutput)
  if (directText !== undefined) return directText

  const parts: string[] = []
  forEachOutputTextPart(output, (part) => {
    const text = readNonEmptyString(part.text)
    if (text !== undefined) parts.push(text)
  })
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

function collectUniqueCitationHits(
  output: readonly unknown[],
): readonly NativeWebSearchHit[] {
  const seen = new Set<string>()
  const hits: NativeWebSearchHit[] = []
  forEachOutputTextPart(output, (part) => {
    if (!Array.isArray(part.annotations)) return
    for (const annotation of part.annotations) {
      if (!isRecord(annotation) || annotation.type !== 'url_citation') continue
      const url = readNonEmptyString(annotation.url)
      if (url === undefined || seen.has(url)) continue
      const title = readNonEmptyString(annotation.title) ?? url
      seen.add(url)
      hits.push({ title, url })
    }
  })
  return hits
}

function forEachOutputTextPart(
  output: readonly unknown[],
  visit: (part: Readonly<Record<string, unknown>>) => void,
): void {
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) {
      continue
    }
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text') visit(part)
    }
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length === 0 ? undefined : text
}

function nativeWebSearchDescription(now = new Date()): string {
  const currentMonth = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(now)
  return `- Allows OpenCode to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond the model's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response

Usage notes:
  - It is currently ${currentMonth}. Use the correct year when searching for recent information, documentation, or current events.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
