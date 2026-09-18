# LiteLLM client toolkit for OpenCode and Codex

One command to connect OpenCode, Codex, and Claude Code to your LiteLLM
gateway — model discovery, search tools, MCP servers, and auth included.

## 환경별 설치 안내

- [Windows: PowerShell / CMD](docs/README.windows.md)
- [macOS: Terminal / Codex 데스크톱](docs/README.macos.md)
- [Linux / WSL / SSH](docs/README.linux.md)
- [공통 로그인·모델 갱신·문제 해결](docs/client-setup.md)

## Quick start

For SSO, install the official LiteLLM CLI with [uv](https://docs.astral.sh/uv/getting-started/installation/). This uses a Python tool environment managed by uv.

```bash
uv tool install 'litellm[cli]==1.101.0'
lite --version
```

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
  npx @happycastle/opencode-litellm install --auth env --non-interactive

# Codex only
LITELLM_BASE_URL=https://your-gateway.com LITELLM_PROXY_API_KEY=your-key \
  npx @happycastle/codex-litellm install --auth env --non-interactive
```

## Requirements

- Node.js `^22.22.2 || ^24.12.0 || >=26.0.0`
- OpenCode and/or Codex installed
- Official `lite` CLI `1.101.0` on PATH for SSO; Python is required by that CLI
- A reachable LiteLLM gateway

Choose the environment guide above for shell commands and configuration paths.

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
| `hybrid-server` | One picker; gateway server routes subscription, auto fallback, and paid models |
| `hybrid-client` | Same picker; a local proxy routes requests while the toolkit launches Codex |

To combine your personal subscription with a paid gateway model:

```bash
codex login
npx @happycastle/codex-litellm install --codex-mode hybrid-server --codex-fallback-model <gateway-model>
npx @happycastle/codex-litellm codex
```

Use `hybrid-client` instead when the server has no hybrid extension. Both modes
require your gateway login/key and keep Codex's own ChatGPT login and refresh.
The fallback must be a chat model available to that gateway key; installation
and each launch validate it. Interactive setup uses the selected gateway model
as the fallback when the flag is omitted. Selecting auto explicitly permits paid
usage under your gateway key's existing model permissions and budget.

The picker shows `subscription/<model>` (subscription only), `auto/<model>`
(subscription first, then the configured fallback), and `litellm/<model>`
(gateway directly). Only a structured `usage_limit_reached` error before any
semantic stream output triggers automatic fallback. Ordinary 429s, authentication
errors, timeouts, and failures after output/tool events do not trigger a paid
retry. Each request tries the subscription again, so it resumes after quota reset.

Hybrid routing sends full conversation text and tool history over HTTP, removes
provider-scoped reasoning IDs, and rejects opaque compaction checkpoints,
item references, and `previous_response_id` instead of discarding conversation
state. Start a fresh hybrid task for an older session with such state. Pick a
fallback that supports your tools and input modalities. Gateway failures remain
visible; the router never chooses another paid model on its own.

Server mode requires a gateway extension exposing `/codex-hybrid/responses`
with the model prefixes and quota rules above. Requests carry the Codex bearer
in `Authorization`, the gateway credential in `x-litellm-api-key`, and the paid
target in `x-codex-fallback-model`. The extension must admit the gateway key and
send paid inference through the gateway's authenticated Responses endpoint.
Use client mode with gateways that have only the standard `/v1/responses` route.
Server mode passes your Codex access token through your trusted gateway to ChatGPT, while
paid requests carry only the gateway key. Client mode sends the Codex access
token directly to ChatGPT. Its authenticated listener binds only to an ephemeral
loopback port and shuts down with the child. Launch it with `codex-litellm codex`;
opening the desktop icon alone does not start the local proxy. Server mode can
use the desktop with the configured gateway key environment available to it.

Gateway catalog rows are visible in `/model` and advertise native search.
The installer sets `web_search = "live"`, so Codex sends the Responses
`web_search` tool through LiteLLM. The gateway must enable LiteLLM's documented
`websearch_interception` callback and configure a search tool.

The toolkit launcher refreshes the authorized gateway catalog before each
Codex gateway launch. It reads the installed CLI's current native model fields,
preserves valid model selections, and stops if discovery or native catalog
loading fails. It does not fall back to a stale list after a key or permission
change. The 0.8.0 release target is Codex CLI `0.154.0`.

> **Codex desktop setup**
>
> The installer writes `~/.codex/config.toml` and model catalogs for the
> Codex desktop app. A compatible `codex` CLI must be on PATH during setup:
> the installer reads its native catalog with `codex debug models --bundled`.
>
> ```bash
> codex --version
> npx @happycastle/codex-litellm install --codex-mode gateway
>
> # Then restart the Codex desktop app to load the generated configuration.
> ```
>
> Opening the app icon does not run the toolkit launch refresh. Rerun install
> when its gateway catalog needs updating; CLI users get automatic refresh
> through `codex-litellm codex`.
>
> For SSO gateway mode, Codex runs a private helper that calls `lite --base-url <origin> auth print-token`
> with OS keyring access disabled. Both SSO and saved manual-key mode install
> `~/.codex/libexec/litellm-auth-token.mjs`. In manual-key mode it reads the
> toolkit's separate API-key file. The gateway key is not embedded in the Codex configuration.
> SSO requires `lite` to be available to the app's process as well as your shell.
>
> In `both` mode, the OAuth profile is written to
> `~/.codex/codex-oauth.config.toml`. Launch it with
> `npx @happycastle/codex-litellm codex --profile codex-oauth`.
> Gateway admission for OAuth and configured MCP servers is supplied only to
> the child process by the toolkit launcher. Opening the app icon does not
> supply those variables; no key is exported to the macOS login session.

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

The toolkit delegates login to `lite --base-url <url> --api-key '' login --pkce`, token
resolution/renewal to `lite --base-url <url> auth print-token`, and logout to
`lite --base-url <url> logout`. It does not implement a separate browser or
polling flow. `auth print-token` emits a credential for its caller; the toolkit
captures it instead of displaying it.

The empty login key skips native renewal of a previous credential before a new
sign-in. Login succeeds only after native metadata records a newer finite login
timestamp and the new exact-origin credential is usable; a failed or cancelled
attempt does not reuse the earlier login as proof of success.

The toolkit forces `LITELLM_CLI_DISABLE_KEYRING=1` on every native LiteLLM
command, including the helper used by direct Codex launches. The official CLI
stores SSO credentials in `~/.litellm/token.json` with owner-only permissions.
Managed Codex configs and launches also select `file` for both
`cli_auth_credentials_store` and `mcp_oauth_credentials_store`.
Do not copy this file as a portable login or delete it instead of logging out.
Reinstall existing client configurations to replace the old direct `lite`
command. If a previous login exists only in the OS keychain, run the toolkit's
`login` command again to create a file-based login. The toolkit never reads,
migrates, or deletes existing OS keychain entries. Logout clears the file-based
session through the official CLI; missing metadata remains an unverified logout.
See the [pinned native authentication contract](docs/official-sources.md#litellm-authentication-and-agent-contracts).

### Environment key

```bash
export LITELLM_PROXY_API_KEY='your-key'
npx @happycastle/opencode-litellm install --auth env
```

Or enter the key interactively with `--auth env`. The toolkit stores this
explicit API key in `~/.config/opencode-litellm/api-key.json`, or
`$XDG_CONFIG_HOME/opencode-litellm/api-key.json` when configured. The file
contains `base_url` and `key` and uses mode `0600` on POSIX. The launcher and
manual-key Codex reader use this file; the official CLI exclusively owns
`~/.litellm/token.json` and its file-based SSO credentials. The configured
environment variable takes precedence in environment-key mode.

OpenCode installation records the selected mode as the LiteLLM plugin tuple's
`auth` option (`"env"` or `"sso"`). Direct desktop launches then read only that
mode's exact-origin credential, so a saved manual key and native SSO login can
coexist without switching accounts. An explicitly resolved provider key still
takes precedence. Reinstall to update an older plugin tuple; standalone tuples
without `auth` retain native SSO fallback and do not infer a manual key.

**Upgrading to 0.8.0:** manually entered keys saved by older toolkit versions
must be entered again through `install --auth env`. The toolkit does not
automatically infer or copy a manual key from the official SSO store. For SSO,
install the official CLI and run `login` again.

The toolkit never uses `launchctl setenv`. OAuth and MCP admission keys are
passed only to the launched client. Logout retains cleanup for a legacy
launchd variable; already running clients must be restarted.

## Common flags

```text
--target <opencode|codex|both>     Which client(s) to configure
--base-url <url>                   LiteLLM gateway origin
--auth <sso|env>                   Authentication method
--codex-mode <gateway|oauth|both|hybrid-server|hybrid-client> Codex connection mode
--codex-fallback-model <model>     Paid gateway model for hybrid auto routing
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
# In Codex, use /model to inspect the configured gateway catalog.
# codex debug models --bundled shows the bundled reference catalog, not gateway access.
```

Release qualification targets Codex CLI `0.154.0` and OpenCode SDK/plugin
`1.18.31`. Native model inventory is inspected with Codex `model/list` or
OpenCode's provider APIs; the [source notes](docs/official-sources.md) explain
why custom LiteLLM discovery still uses the OpenCode config hook.

## Discovery endpoints

| Surface | Endpoint | Result |
|---|---|---|
| Models | `GET /v1/models` | OpenCode picker + Codex JSON catalog; permitted routing groups appear when the remote gateway is LiteLLM 1.98+ |
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
npx @happycastle/opencode-litellm install --auth env --non-interactive
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

This isolated local pin never changes the remote LiteLLM gateway version.

</details>

<details>
<summary>Managed files and recovery</summary>

The installer stages changes atomically. If a forced kill interrupts mid-write,
the original file remains at `<destination>.<uuid>.rollback.tmp`. Rerunning
`install` converges without clobbering recovery files.

Relevant paths (SSO storage is owned by the official CLI):

```text
~/.litellm/token.json
~/.config/opencode-litellm/api-key.json
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
The toolkit launcher supplies that admission key to the Codex child; Codex
continues to own the ChatGPT `Authorization` header. Use the launcher for
OAuth and authenticated MCP access rather than exporting keys globally.

`oauth` and `both` modes preflight the installed Codex bundled catalog.
The 0.8.0 release target is `0.154.0`; the catalog must expose `gpt-5.6-sol`,
`gpt-5.6-terra`, and `gpt-5.6-luna`.

Request compression is disabled in OAuth configs to avoid zstd parsing
issues with the pinned LiteLLM pass-through.

</details>

## License

MIT — builds on [`yuseferi/opencode-litellm`](https://github.com/yuseferi/opencode-litellm).
