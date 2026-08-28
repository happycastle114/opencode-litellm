# @happycastle/codex-litellm

Thin Codex-focused wrapper for
[`@happycastle/opencode-litellm`](https://github.com/happycastle114/opencode-litellm).
Defaults `install` to `--target codex`; everything else is forwarded to the
core CLI.

## Quick start

```bash
# Install for Codex (interactive)
npx @happycastle/codex-litellm install

# Install for both Codex and OpenCode
npx @happycastle/codex-litellm install --target both

# Launch Codex with the installed config
npx @happycastle/opencode-litellm codex
```

## What it does

- Prompts for LiteLLM gateway URL, auth (SSO or env key), and Codex mode
  (`gateway`, `oauth`, or `both`)
- Discovers models, search tools, MCP servers, and toolsets
- Writes a `/model`-compatible Codex catalog and enables native live web search
- Installs the shared research skill at `~/.agents/skills/litellm-research-router/`

## Requirements

- Node.js `^22.22.2 || ^24.12.0 || >=26.0.0`
- Codex installed
- A reachable LiteLLM gateway

## License

MIT — see [LICENSE](./LICENSE).
