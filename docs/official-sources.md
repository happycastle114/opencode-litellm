# Official sources and support matrix

Checked on 2026-07-20. Runtime behavior is documented against the public
LiteLLM, OpenCode, and Codex interfaces below. GitHub source references use
immutable commits where the implementation contract matters.

## LiteLLM authentication and agent contracts

The installer is a Node.js implementation of LiteLLM's documented CLI SSO
wire flow. It does not shell out to Python, import the `lite` executable, or
copy a user credential into client configuration. The official CLI remains a
useful compatibility reference and an optional independent diagnostic.

The audited LiteLLM source baseline is
[`litellm==1.92.0`](https://pypi.org/project/litellm/1.92.0/), whose tag resolves
to commit
[`b3086ccd`](https://github.com/BerriAI/litellm/tree/b3086ccd74553565c9a39716e72303ae985555f9).
Upgrade the baseline only after re-auditing the protocol and running the
packaging and live-login checks.

| Contract | Immutable or official source | Toolkit behavior |
|---|---|---|
| CLI SSO start, poll, and browser verification | [`auth.py`](https://github.com/BerriAI/litellm/blob/b3086ccd74553565c9a39716e72303ae985555f9/litellm/proxy/client/cli/commands/auth.py) and [`cli/main.py`](https://github.com/BerriAI/litellm/blob/b3086ccd74553565c9a39716e72303ae985555f9/litellm/proxy/client/cli/main.py) | Use `POST /sso/cli/start`, poll `/sso/cli/poll/<login_id>` with `x-litellm-cli-poll-secret`, and verify same-origin browser URLs or `source=litellm-cli` fallback URLs |
| Token file and POSIX permissions | [`auth.py`](https://github.com/BerriAI/litellm/blob/b3086ccd74553565c9a39716e72303ae985555f9/litellm/proxy/client/cli/commands/auth.py) | Atomically write `~/.litellm/token.json` as `0600`; preserve the official `key` field and never expose it in output |
| Exact-origin key selection | [`cli_token_utils.py`](https://github.com/BerriAI/litellm/blob/b3086ccd74553565c9a39716e72303ae985555f9/litellm/litellm_core_utils/cli_token_utils.py) and security fix [`231c430`](https://github.com/BerriAI/litellm/commit/231c4302001b865a88495405b9944cf9cc41ae04) | Read only `key` when the normalized `base_url` matches the configured gateway; ignore `jwt_token` and fail closed on cross-origin values |
| `lite claude`, `codex`, and `opencode` environment conventions | Feature commit [`20e453f`](https://github.com/BerriAI/litellm/commit/20e453f698dc0758a15a491818411372da041415) and [`agents.py`](https://github.com/BerriAI/litellm/blob/b3086ccd74553565c9a39716e72303ae985555f9/litellm/proxy/client/cli/commands/agents.py) | Reproduce only the safe routing boundary in the direct launcher: Claude `/claude-max`, Codex transient gateway key, OpenCode gateway URL; no `lite` subprocess is required |

The official LiteLLM public references used by the installer are:

- [Search API](https://docs.litellm.ai/docs/search), including configured
  `search_tools` discovery and `POST /v1/search/<name>`.
- [Model discovery](https://docs.litellm.ai/docs/proxy/model_discovery), using
  authenticated `GET /v1/models`.
- [MCP overview](https://docs.litellm.ai/docs/mcp), including namespaced
  `/{server_name}/mcp` routes and key/team permissions.
- [MCP toolsets](https://docs.litellm.ai/docs/mcp_toolsets), including
  `GET /v1/mcp/toolset` and the named toolset runtime route.
- [MCP Tool Search](https://docs.litellm.ai/docs/mcp_tool_search) and [MCP
  permission management](https://docs.litellm.ai/docs/mcp_control). Tool Search
  is a separate per-key `object_permission.mcp_tool_search_enabled` feature;
  this installer does not enable it implicitly.
- [Claude Code with a Max subscription](https://docs.litellm.ai/docs/tutorials/claude_code_max_subscription).
  The flow is for Claude Code. OpenCode's own [provider
  documentation](https://opencode.ai/docs/providers) says Anthropic prohibits
  Pro/Max subscription plugins for OpenCode, so this toolkit does not install
  one.

## Gateway discovery contract

The installer authenticates once and concurrently requests these surfaces:

| Surface | Endpoint | Failure policy | Client result |
|---|---|---|---|
| Models | `GET /v1/models` (required) | Required; HTTP or schema failure stops install | OpenCode startup picker and Codex gateway catalog |
| Search tools | `GET /search_tools/list` | Optional; unavailable/unsupported/invalid responses become warnings | OpenCode `searchTools` entries, with the first selected tool mapped to `websearch` |
| MCP servers | `GET /v1/mcp/server` | Optional; unavailable/unsupported/invalid responses become warnings | Authorized `/<server_name>/mcp` remote entries |
| MCP toolsets | `GET /v1/mcp/toolset` | Optional; 404/405 and other failures become warnings | Authorized `/toolset/<url-encoded-name>/mcp` remote entries |

The current gateway key is the source of truth for visibility. Empty resource
filters select all visible rows; explicit `--search`, `--mcp`, `--toolset`, and
`--disable-mcp` filters are applied after discovery. The installer does not
hard-code a search provider or MCP server name.

OpenCode search tools call the documented
`POST /v1/search/<search_tool_name>` shape with `query`, `max_results`, and
`search_domain_filter`. MCP and toolset entries carry an environment-backed
Bearer reference at runtime; literal keys are rejected rather than written to
JSON or TOML.

## OpenCode contract

| Surface | Official documentation | Toolkit use |
|---|---|---|
| Local and npm plugins | [Plugins](https://opencode.ai/docs/plugins/) | Load a detached Git checkout through a `file://` entry; verify origin and full SHA before install |
| Providers and model picker | [Providers](https://opencode.ai/docs/providers) | Use `@ai-sdk/openai` and inject live model metadata during the startup config hook |
| Search tools | [Tools](https://opencode.ai/docs/tools/) | Register LiteLLM search routes; `websearch` is only overridden when the generated option explicitly opts in |
| Remote MCP | [MCP servers](https://opencode.ai/docs/mcp-servers/) | Register only the gateway-authorized server/toolset routes and preserve existing entries |
| Shared skills | [Agent skills](https://opencode.ai/docs/skills/) | Install one global `~/.agents/skills/litellm-research-router` skill |

OpenCode reads plugin options and runs the config hook at startup. Restart the
client after installation or after a gateway model/MCP catalog change.

## Codex contract

| Surface | Official documentation | Toolkit use |
|---|---|---|
| `model_catalog_json`, `model_provider`, `requires_openai_auth`, `env_http_headers`, and `forced_login_method` | [Configuration reference](https://developers.openai.com/codex/config-reference/) | Generate mutually exclusive gateway and ChatGPT OAuth provider auth sources plus startup catalogs |
| Custom providers and profiles | [Advanced configuration](https://developers.openai.com/codex/config-advanced/) | Keep the gateway in `~/.codex/config.toml`; keep `codex-oauth` as a secondary profile in `both` mode |
| ChatGPT login | [Authentication](https://developers.openai.com/codex/auth/) | Codex owns the OAuth `Authorization` header and login lifecycle |
| Bundled model catalog | Codex CLI `codex debug models --bundled` | Snapshot the exact bundled catalog for the OAuth pass-through picker |
| Shared skills | [Agent skills](https://developers.openai.com/codex/skills/) | Reuse the same global research skill directory |

The OAuth provider is deliberately:

```toml
base_url = "https://gateway.example/codex-oauth"
wire_api = "responses"
requires_openai_auth = true
env_http_headers = { "x-litellm-api-key" = "LITELLM_PROXY_API_KEY" }
```

It does not also set `env_key`, command auth, or an experimental bearer token.
The gateway SSO provider uses the stable generated helper path and a separate
`GET /v1/models` catalog.

## Support and authentication matrix

| Component | Supported boundary | Notes |
|---|---|---|
| Node.js | `>=20` | Required by both package manifests |
| Python / `lite` | Optional | Only needed if you independently use LiteLLM's Python CLI |
| LiteLLM gateway | Authenticated `/v1/models` plus optional search/MCP/toolset endpoints | Optional surfaces degrade to warnings |
| OpenCode | Releases supporting TypeScript `file://` plugins and documented provider/MCP/skill schemas | Restart after installation |
| Codex | Releases exposing the documented config fields and `codex debug models --bundled` | Re-run after Codex upgrades |
| macOS | Full installer path | Uses current-user `launchctl setenv` for OAuth mode; lifecycle logout uses `unsetenv` for the selected auth environment |
| Linux / WSL | Installer, discovery, and shell-based auth references | Export the selected gateway-key environment variable for OAuth mode |
| Native Windows | Config rendering paths | POSIX modes and `launchctl` are not applicable; release qualification remains pending |

| Client path | Gateway authentication | Upstream authentication | Persisted secret by this toolkit |
|---|---|---|---|
| OpenCode | In-memory exact-origin SSO `key` or selected environment variable | LiteLLM routing | None |
| Codex gateway | Command-backed SSO helper or selected environment variable | LiteLLM routing | None |
| Codex OAuth | `x-litellm-api-key` from an environment variable | Codex ChatGPT OAuth owns `Authorization` | None |
| Claude Code Max launcher | LiteLLM `/claude-max` admission header | Claude Code subscription OAuth | None |

## Managed fork and package status

The managed OpenCode checkout pin lives only in
`src/cli/managed-plugin.ts`. This documentation intentionally does not change
that runtime pin:

```text
5c816baec4cd89a053b7ffa54135f941f7c89ffb
```

Installation verifies the expected repository URL, clean worktree, detached
`HEAD`, full SHA, and lockfile-based `npm ci --ignore-scripts` install.

| Package/bin | Manifest | Registry status at documentation time |
|---|---|---|
| `@happycastle114/opencode-litellm` / `opencode-litellm` and `codex-litellm` bins | Root `package.json`, version `0.6.0` | Release candidate; do not claim published |
| `codex-litellm` / `codex-litellm` bin | `packages/codex-litellm/package.json`, exact core dependency `0.6.0` | Release candidate; do not claim published |
| Unscoped `opencode-litellm` | Not owned by this project | Blocked by an unrelated existing publisher |

Until ownership and publication are verified, use the immutable GitHub checkout
and locally packed tarballs shown in the README.
