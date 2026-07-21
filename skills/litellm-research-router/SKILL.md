---
name: litellm-research-router
description: Route research and web-search tasks through the configured LiteLLM tools without persisting credentials.
---

# LiteLLM Research Router

Use the configured LiteLLM search and MCP tools for research tasks. Keep
gateway credentials in runtime environment or provider configuration only;
never copy, echo, or persist a credential in notes, prompts, reports, or
generated files.

Prefer the OpenCode custom `litellm_search` tool for broad discovery only when
the current client exposes it; otherwise use the selected LiteLLM MCP/toolset
search tools. Codex-only installs do not register OpenCode custom tools, so do
not assume that `litellm_search` exists. Use a provider-specific search tool
when the task explicitly names one. Preserve source URLs and distinguish
observed evidence from inference in the result.
