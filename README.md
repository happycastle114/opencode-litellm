# LiteLLM client toolkit for OpenCode and Codex

One command to connect OpenCode, Codex, and Claude Code to your LiteLLM
gateway — model discovery, search tools, MCP servers, and auth included.

## Quick start

```bash
# OpenCode
npx @happycastle/opencode-litellm install

# Codex
npx @happycastle/codex-litellm install

# Both at once
npx @happycastle/opencode-litellm install --target both
```

The interactive installer asks for your gateway URL, walks you through SSO
login (or environment-key auth), discovers available models/search/MCP
resources, and writes the client config. Restart OpenCode or Codex after
install.

### One-liner (non-interactive)

```bash
LITELLM_BASE_URL=https://your-gateway.com LITELLM_PROXY_API_KEY=your-key \
  npx @happycastle/opencode-litellm install --non-interactive

# Codex only
LITELLM_BASE_URL=https://your-gateway.com LITELLM_PROXY_API_KEY=your-key \
  npx @happycastle/codex-litellm install --non-interactive
```

## Requirements

- Node.js `^22.22.2 || ^24.12.0 || >=26.0.0`
- OpenCode and/or Codex installed
- A reachable LiteLLM gateway

Native Windows setup is documented in [docs/windows-setup.md](docs/windows-setup.md),
including a checked `.bat` entrypoint for configuring both clients.

## Usage by client

### OpenCode

```bash
# 1. Install (interactive — asks gateway URL, auth, models, MCP, etc.)
npx @happycastle/opencode-litellm install

# 2. Launch OpenCode with the installed config
npx @happycastle/opencode-litellm opencode
```

What it configures:

- LiteLLM plugin (git-pinned checkout) + `@ai-sdk/openai` provider
- Model picker snapshot from `GET /v1/models`
- Native `web-search` from the managed plugin, backed by LiteLLM's Responses
  `web_search` interception and the active OpenCode model
- Named LiteLLM search tools, MCP servers, and MCP toolsets
- Shared research skill at `~/.agents/skills/litellm-research-router/`

### Codex

```bash
# 1. Install (interactive — asks gateway URL, auth, codex mode, etc.)
npx @happycastle/codex-litellm install

# 2. Launch Codex with the installed config
npx @happycastle/opencode-litellm codex
```

Codex connection modes (`--codex-mode`):

| Mode | What it does |
|---|---|
| `gateway` | Gateway provider + model catalog from `/v1/models` |
| `oauth` | ChatGPT OAuth pass-through provider |
| `both` (default) | Gateway as main + OAuth as `--profile codex-oauth` |

Gateway catalog rows are visible in `/model` and advertise native search.
The installer sets `web_search = "live"`, so Codex sends the Responses
`web_search` tool through LiteLLM. The gateway must enable LiteLLM's documented
`websearch_interception` callback and configure a search tool.

> **Codex desktop app only (no CLI)?**
>
> The installer writes `~/.codex/config.toml` and model catalogs that the
> Codex desktop app reads on startup. You don't need the `codex` CLI binary.
>
> ```bash
> # Just run install — it configures everything the desktop app needs
> npx @happycastle/codex-litellm install
>
> # Then restart the Codex desktop app. Models appear in the picker.
> ```
>
> For `gateway` mode, the installer writes a small auth helper at
> `~/.codex/libexec/litellm-auth-token.mjs` so the desktop app can resolve
> your gateway key from `~/.litellm/token.json` without storing it in config.
>
> For `oauth` or `both` mode, the OAuth profile is written to
> `~/.codex/codex-oauth.config.toml`. Use `codex --profile codex-oauth`
> from the CLI; the desktop app reads the main `config.toml` gateway config.

### Claude Code (bonus)

```bash
npx @happycastle/opencode-litellm claude
```

Routes Claude Code through the LiteLLM `/claude-max` pass-through path.
Existing Anthropic OAuth stays untouched.

## Authentication

### SSO (default)

```bash
npx @happycastle/opencode-litellm login --base-url https://your-gateway.com
npx @happycastle/opencode-litellm whoami --base-url https://your-gateway.com
npx @happycastle/opencode-litellm logout --base-url https://your-gateway.com
```

Token is stored at `~/.litellm/token.json` (mode `0600`). No Python or
`lite` CLI needed.

### Environment key

```bash
export LITELLM_PROXY_API_KEY='your-key'
npx @happycastle/opencode-litellm install --auth env
```

Or enter the key interactively — it is stored in `~/.litellm/token.json`
(mode `0600`) and reused by the launcher and Codex auth helper.

## Common flags

```text
--target <opencode|codex|both>     Which client(s) to configure
--base-url <url>                   LiteLLM gateway origin
--auth <sso|env>                   Authentication method
--codex-mode <gateway|oauth|both>  Codex connection mode
--search <name>                    Select search tools (repeatable)
--mcp <name>                       Select MCP servers (repeatable)
--toolset <name>                   Select MCP toolsets (repeatable)
--no-search | --no-mcp | --no-toolsets   Skip discovery
--non-interactive                  Scripted install (needs explicit values)
```

## Post-install checks

```bash
npx @happycastle/opencode-litellm doctor --target both --json
opencode models litellm        # OpenCode model picker
codex debug models --bundled   # Codex model catalog
```

Release qualification covers Codex CLI 0.144.1 and current stable 0.150.1.

## Discovery endpoints

| Surface | Endpoint | Result |
|---|---|---|
| Models | `GET /v1/models` | OpenCode picker + Codex JSON catalog, including permitted LiteLLM routing groups |
| Search tools | `GET /search_tools/list` | OpenCode `searchTools` |
| MCP servers | `GET /v1/mcp/server` | Remote MCP entries |
| MCP toolsets | `GET /v1/mcp/toolset` | Toolset MCP entries |

## Packages

| Package | Binary | Purpose |
|---|---|---|
| `@happycastle/opencode-litellm` | `opencode-litellm`, `codex-litellm` | Core toolkit + CLI |
| `@happycastle/codex-litellm` | `codex-litellm` | Thin wrapper (defaults `--target codex`) |

## Development

```bash
git clone https://github.com/happycastle114/opencode-litellm.git
cd opencode-litellm
npm ci
npm test          # build + bun test
npm run typecheck
```

## Advanced

<details>
<summary>Non-interactive / scripted install</summary>

```bash
LITELLM_BASE_URL=https://llm.example.com \
LITELLM_PROXY_API_KEY='your-key' \
npx @happycastle/opencode-litellm install --non-interactive
```

</details>

<details>
<summary>Auto Router for Claude Code (optional)</summary>

Opt-in LiteLLM Auto Router wizard. Requires `uv >= 0.10.9`. Affects Claude
Code only; OpenCode and Codex configs are unchanged.

```bash
npx @happycastle/opencode-litellm install --auto-router configure
npx @happycastle/opencode-litellm install --auto-router dry-run
```

Start/stop the pinned proxy:

```bash
uv tool run --isolated --from 'litellm[proxy]==1.98.0' lite autoroute up
uv tool run --isolated --from 'litellm[proxy]==1.98.0' lite autoroute down
```

</details>

<details>
<summary>Managed files and recovery</summary>

The installer stages changes atomically. If a forced kill interrupts mid-write,
the original file remains at `<destination>.<uuid>.rollback.tmp`. Rerunning
`install` converges without clobbering recovery files.

Key managed paths:

```text
~/.litellm/token.json
~/.config/opencode-litellm/launch.json
~/.codex/config.toml
~/.codex/litellm-models.json
~/.codex/codex-oauth.config.toml
~/.agents/skills/litellm-research-router/
~/.claude/settings.json
```

There is no `uninstall` command. Restore the newest backup to revert.

</details>

<details>
<summary>Install from a fixed GitHub revision</summary>

```bash
export TOOLKIT_SHA='<full-40-char-sha>'
npx --yes --package "github:happycastle114/opencode-litellm#${TOOLKIT_SHA}" opencode-litellm install
```

This runs the package's `prepare` lifecycle in npm's detached checkout.
Leave npm lifecycle scripts enabled.

</details>

<details>
<summary>Codex OAuth details</summary>

The OAuth provider uses `base_url = <gateway>/codex-oauth`,
`wire_api = "responses"`, `requires_openai_auth = true`,
`forced_login_method = "chatgpt"`, and
`env_http_headers = { "x-litellm-api-key" = "LITELLM_PROXY_API_KEY" }`.

`oauth` and `both` modes preflight the installed Codex bundled catalog
(requires Codex 0.144.0+). The catalog must expose `gpt-5.6-sol`,
`gpt-5.6-terra`, and `gpt-5.6-luna`.

Request compression is disabled in OAuth configs to avoid zstd parsing
issues with the pinned LiteLLM pass-through.

</details>

## License

MIT — builds on [`yuseferi/opencode-litellm`](https://github.com/yuseferi/opencode-litellm).
