import { tool, type ToolDefinition } from '@opencode-ai/plugin'
import {
  LiteLLMSearchError,
  searchLiteLLM,
  type LiteLLMSearchEndpoint,
  type LiteLLMSearchRequest,
} from './client'
import type { LiteLLMSearchToolOption } from './options'

const DEFAULT_MAX_RESULTS = 10

type SearchEndpointResolver = () => LiteLLMSearchEndpoint | undefined

export function createSearchTools(
  options: readonly LiteLLMSearchToolOption[],
  resolveEndpoint: SearchEndpointResolver,
): Record<string, ToolDefinition> {
  const definitions: Record<string, ToolDefinition> = {}
  for (const option of options) {
    definitions[option.toolName] = createSearchTool(option, resolveEndpoint)
  }
  return definitions
}

function createSearchTool(
  option: LiteLLMSearchToolOption,
  resolveEndpoint: SearchEndpointResolver,
): ToolDefinition {
  return tool({
    description:
      option.description ??
      `Search the web with the LiteLLM search tool "${option.searchToolName}".`,
    args: {
      query: tool.schema.string().trim().min(1),
      max_results: tool.schema.number().int().min(1).max(20).optional(),
      search_domain_filter: tool.schema
        .array(tool.schema.string().trim().min(1))
        .max(20)
        .optional(),
    },
    async execute(args, context) {
      const endpoint = resolveEndpoint()
      if (!endpoint) {
        throw new LiteLLMSearchError(
          'LiteLLM search base URL is not configured',
        )
      }

      const request: LiteLLMSearchRequest = {
        query: args.query,
        max_results:
          args.max_results ?? option.defaultMaxResults ?? DEFAULT_MAX_RESULTS,
        ...(args.search_domain_filter === undefined
          ? {}
          : { search_domain_filter: args.search_domain_filter }),
      }
      const response = await searchLiteLLM({
        endpoint,
        searchToolName: option.searchToolName,
        request,
        signal: context.abort,
      })
      const metadata = { resultCount: response.results.length }
      context.metadata({ title: `Web search: ${args.query}`, metadata })
      return {
        output: JSON.stringify(response.results, null, 2),
        metadata,
      }
    },
  })
}
