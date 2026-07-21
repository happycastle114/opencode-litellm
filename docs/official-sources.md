# Official sources and support matrix

Checked on 2026-07-21. Runtime behavior is documented against the public
LiteLLM, OpenCode, Codex, Claude Code, and Oh My OpenAgent interfaces below.
GitHub source references use immutable commits where the implementation
contract matters.

## LiteLLM authentication and agent contracts

The installer is a Node.js implementation of LiteLLM's documented CLI SSO
wire flow. It does not shell out to Python, import the `lite` executable, or
copy a user credential into client configuration. The official CLI remains a
useful compatibility reference and an optional independent diagnostic.

The deployed LiteLLM source baseline is
[`v1.94.0-rc.1`](https://github.com/BerriAI/litellm/releases/tag/v1.94.0-rc.1),
whose tag resolves to commit
[`5d4c4d0f`](https://github.com/BerriAI/litellm/tree/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5).
Upgrade the baseline only after re-auditing the protocol and running the
packaging and live-login checks.

| Contract | Immutable or official source | Toolkit behavior |
|---|---|---|
| CLI SSO start, poll, and browser verification | [`auth.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/client/cli/commands/auth.py) and [`ui_sso.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/management_endpoints/ui_sso.py) | Use `POST /sso/cli/start`, poll `/sso/cli/poll/<login_id>` with `x-litellm-cli-poll-secret`, and verify same-origin browser URLs or `source=litellm-cli` fallback URLs |
| Token file and POSIX permissions | [`auth.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/client/cli/commands/auth.py) | Atomically write `~/.litellm/token.json` as `0600`; preserve the official `key` field and never expose it in output |
| Exact-origin key selection | [`cli_token_utils.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/litellm_core_utils/cli_token_utils.py) and security fix [`231c430`](https://github.com/BerriAI/litellm/commit/231c4302001b865a88495405b9944cf9cc41ae04) | Read only `key` when the normalized `base_url` matches the configured gateway; ignore `jwt_token` and fail closed on cross-origin values |
| `lite claude`, `codex`, and `opencode` environment conventions | Feature commit [`20e453f`](https://github.com/BerriAI/litellm/commit/20e453f698dc0758a15a491818411372da041415) and [`agents.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/client/cli/commands/agents.py) | Persist merged, per-client, secret-free launch intent; reproduce the safe child boundary without a `lite` subprocess; expose selected LiteLLM search tools under non-reserved IDs; scrub ambient credential/control variables; never inject a Codex profile |
| Claude Max gateway admission | [`user_api_key_auth.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/auth/user_api_key_auth.py#L121-L126) and its [scheme normalizer](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/auth/user_api_key_auth.py#L260-L281) | Send `x-litellm-api-key: Bearer <key>`; the configured generic pass-through route authenticates through `user_api_key_auth`, which removes the scheme before key validation while preserving Claude OAuth in `Authorization` |

The official LiteLLM public references used by the installer are:

- [Search API](https://docs.litellm.ai/docs/search), including configured
  `search_tools` and `POST /v1/search/<name>`. The permission-filtered
  `GET /search_tools/list` route is implemented in the pinned gateway's
  [`search_tool_management.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/search_endpoints/search_tool_management.py).
  If that route is unavailable or its response is invalid, the installer falls
  back to the router-wide `GET /v1/search/tools` route and emits a typed warning;
  its `{ "object": "list", "data": [...] }` response is fixed in
  [`endpoints.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/search_endpoints/endpoints.py).
  Search invocation still applies the current key's object permissions.
- [Model discovery](https://docs.litellm.ai/docs/proxy/model_discovery), using
  authenticated `GET /v1/models`.
- [MCP overview](https://docs.litellm.ai/docs/mcp), including the current
  fixed `/mcp` route, `x-mcp-servers` filtering, and key/team permissions.
- [MCP toolsets](https://docs.litellm.ai/docs/mcp_toolsets), including
  `GET /v1/mcp/toolset` and the named toolset runtime route.
- [MCP Tool Search](https://docs.litellm.ai/docs/mcp_tool_search) and [MCP
  permission management](https://docs.litellm.ai/docs/mcp_control). Tool Search
  is a separate per-key `object_permission.mcp_tool_search_enabled` feature;
  this installer does not enable it implicitly.
- [Claude Code with a Max subscription](https://docs.litellm.ai/docs/tutorials/claude_code_max_subscription).
  This is a LiteLLM-documented pass-through flow. Anthropic's current
  [gateway documentation](https://code.claude.com/docs/en/third-party-integrations)
  documents `ANTHROPIC_BASE_URL` for general LLM gateways, but does not claim
  support for this Max OAuth proxy. The flow is for Claude Code. OpenCode's own
  [provider documentation](https://opencode.ai/docs/providers) says Anthropic
  prohibits Pro/Max subscription plugins for OpenCode, so this toolkit does
  not install one.
- [Claude Code marketplace source](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/anthropic_endpoints/claude_code_endpoints/claude_code_marketplace.py).
  The installer merges `extraKnownMarketplaces.litellm` into
  `~/.claude/settings.json` using Claude Code's nested
  `source: { source: "url", url: "..." }` shape. See the official
  [extraKnownMarketplaces settings reference](https://code.claude.com/docs/en/settings#extraknownmarketplaces).
  The URL ends in `/claude-code/marketplace.json`; it stores no credential and
  makes no claim that the marketplace currently contains plugins. Legacy flat
  `source`/`url` entries are migrated to the nested object, and a terminal
  gateway `/v1` is removed before the marketplace path is appended.

## Gateway discovery contract

The installer authenticates once and concurrently requests these surfaces:

| Surface | Endpoint | Failure policy | Client result |
|---|---|---|---|
| Models | `GET /v1/models` (required) | Required; HTTP or schema failure stops install | OpenCode startup picker and Codex gateway catalog |
| Search tools | Primary `GET /search_tools/list` (permission-filtered); fallback `GET /v1/search/tools` (`{ "object": "list", "data": [...] }`) | Optional; primary names are permission-filtered. A successful router-wide fallback emits a typed warning; unavailable/invalid responses become warnings | Selected OpenCode `searchTools` use `litellm_search` plus deterministic non-reserved `litellm_*` IDs; invocation permission is checked by POST |
| MCP servers | `GET /v1/mcp/server` | Optional; unavailable/unsupported/invalid responses become warnings | Available `/<server_name>/mcp` compatibility entries for the pinned deployment; invocation enforces gateway permissions |
| MCP toolsets | `GET /v1/mcp/toolset` | Optional; 404/405 and other failures become warnings | Available `/toolset/<url-encoded-name>/mcp` entries exposed by the pinned `v1.94.0-rc.1` gateway; invocation enforces gateway permissions |

Authenticated model, MCP, and toolset discovery determine what their respective
endpoints return to the current identity. Search discovery first uses the
permission-filtered `GET /search_tools/list` route. If that route is unavailable,
unsupported, or invalid, `GET /v1/search/tools` provides router-wide inventory
and the installer emits a typed fallback warning (`available_fallback`); that
response does not apply the caller's object permissions. Empty filters select
all returned rows.
Explicit `--search`, `--mcp`, `--toolset`, `--enable-mcp`, and `--disable-mcp`
filters are applied after discovery.

When optional search or toolset discovery fails, explicit search/toolset names
are retained in order and reported as configured without verification. When
available search inventory is returned, an unknown name is skipped, but a
listed name is not proof of authorization. With no explicit names, a failed
optional surface stays empty. The installer does not hard-code a search
provider or MCP server name.

MCP inclusion and startup state are separate. A discovered and selected
`minimax_search` server is disabled by default; repeatable
`--enable-mcp minimax_search` removes that default disable. The state flag does
not add a server excluded by a narrowed `--mcp` filter. Other selected MCP
servers default enabled unless an explicit `--disable-mcp` override applies,
and one name cannot appear in both state lists.

OpenCode search tools call the documented
`POST /v1/search/<search_tool_name>` shape with `query`, `max_results`, and
`search_domain_filter`; that POST is where LiteLLM enforces the current key's
search permissions. The first selected tool is named `litellm_search`; additional
tools use deterministic `litellm_*` names (hyphens become underscores), and the
reserved `websearch` ID is never overridden. The discovery-only `GET /v1/search/tools`, `GET /v1/mcp/server`, `GET /v1/mcp/toolset`, and
`/toolset/<url-encoded-name>/mcp` endpoints are pinned-deployment compatibility
contracts, not universal public client APIs. Current LiteLLM documentation
also uses `/mcp/<name>` as a server-side toolset identifier; that is not the
remote HTTP route exposed by the pinned gateway. MCP and toolset entries carry
an environment-backed Bearer reference at runtime; literal keys are rejected
rather than written to JSON or TOML.

## OpenCode contract

| Surface | Official documentation | Toolkit use |
|---|---|---|
| Local and npm plugins | [Plugins](https://opencode.ai/docs/plugins/) | Load a detached Git checkout through a `file://` entry; verify origin and full SHA before install |
| Config files | [Config](https://opencode.ai/docs/config/) | Prefer an existing `opencode.jsonc` over `opencode.json`; a custom path is preserved exactly in direct launch state |
| Providers and model picker | [Providers](https://opencode.ai/docs/providers) | Use `@ai-sdk/openai`, inject live chat metadata during startup, and exclude known embedding/image-generation/audio-only rows while preserving multimodal chat rows |
| Search tools | [Tools](https://opencode.ai/docs/tools/) | Register selected LiteLLM search routes as `litellm_search` plus deterministic non-reserved `litellm_*` IDs; never override the built-in `websearch`; scrub inherited `OPENCODE_ENABLE_EXA` at direct launch |
| Remote MCP | [MCP servers](https://opencode.ai/docs/mcp-servers/) | Register only gateway-discovered or explicitly selected server/toolset routes and preserve existing entries |
| Shared skills | [Agent skills](https://opencode.ai/docs/skills/) | Install one global `~/.agents/skills/litellm-research-router` skill |

OpenCode reads plugin options and runs the config hook at startup. Restart the
client after installation or after a gateway model/MCP catalog change. The
exact `alibaba-token/qwen3.8-max-preview` identifier is displayed as
`Qwen3.8 Max Preview`; generic models retain deterministic formatting.

## Oh My OpenAgent consumer contract

OpenCode onboarding pins the official consumer package
[`oh-my-openagent@4.19.0`](https://registry.npmjs.org/oh-my-openagent/4.19.0).
The `v4.19.0` tag resolves to immutable commit
[`14083b89`](https://github.com/code-yeongyu/oh-my-openagent/tree/14083b89f1cbf4680be13493a6c4afd67c957e8a).
The audited npm artifact has integrity
`sha512-Ov1a/V750SYoLHy6e6PHyUPaWyRGukjUDe5HzHqFMSKEx8IS0DUeT0EXGQIOO28/DSXE7TE4g82wVAi/UVX0zA==`.

| Contract | Immutable source | Toolkit behavior |
|---|---|---|
| Renamed and legacy config precedence | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) | Resolve renamed JSONC, renamed JSON, legacy JSONC, legacy JSON, then create renamed JSON beside the selected OpenCode config |
| Agent and category model overrides | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) and [schema](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/assets/oh-my-opencode.schema.json) | Route only the bounded planning/research/writing/long-context entries to `litellm/alibaba-token/qwen3.8-max-preview`; preserve unrelated fields and JSONC comments |
| Built-in MCP controls | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) | Preserve the managed OMA `websearch` profile setting separately from LiteLLM tool IDs; LiteLLM never registers the reserved OpenCode `websearch` name |

The installer replaces unversioned, differently versioned, and legacy
`oh-my-opencode` plugin entries with one exact `oh-my-openagent@4.19.0` entry.
It writes the active profile atomically as `0600`. If the exact Qwen model is
not discovered, no Qwen route is invented. The MCP collision policy is applied
on every OpenCode install regardless of Qwen or LiteLLM search selection.

## Codex contract

| Surface | Official documentation | Toolkit use |
|---|---|---|
| `model_catalog_json`, `model_provider`, `requires_openai_auth`, `env_http_headers`, and `forced_login_method` | [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) | Generate mutually exclusive gateway and ChatGPT OAuth provider auth sources plus startup catalogs |
| Custom providers and profiles | [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced) | Keep the gateway in `~/.codex/config.toml`; keep `codex-oauth` as a secondary profile in `both` mode |
| ChatGPT login | [Authentication](https://learn.chatgpt.com/docs/auth) | Codex owns the OAuth `Authorization` header and login lifecycle |
| Bundled model catalog | Codex CLI `codex debug models --bundled` | Copy the exact bundled catalog unchanged for OAuth; inherit its prompt/model template for gateway rows |
| Native OAuth request compression | Codex 0.144.1 [`EnableRequestCompression` default](https://github.com/openai/codex/blob/44918ea10c0f99151c6710411b4322c2f5c96bea/codex-rs/features/src/lib.rs#L1013-L1018) and [OAuth/OpenAI zstd selector](https://github.com/openai/codex/blob/44918ea10c0f99151c6710411b4322c2f5c96bea/codex-rs/core/src/client.rs#L1368-L1376); LiteLLM `1.94.0-rc.1` [JSON body parser](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/common_utils/http_parsing_utils.py#L85-L141) | Disable zstd only in OAuth-active config layers, preserve other feature keys, and restore a pre-existing user value when the main config returns to gateway mode |
| Shared skills | [Build skills](https://learn.chatgpt.com/docs/build-skills) | Install the same global research skill directory for every selected target |

The OAuth provider is deliberately:

```toml
base_url = "https://gateway.example/codex-oauth"
wire_api = "responses"
requires_openai_auth = true
env_http_headers = { "x-litellm-api-key" = "LITELLM_PROXY_API_KEY" }
```

It does not also set `env_key`, command auth, or an experimental bearer token.
The same OAuth-active config layer also contains:

```toml
[features]
enable_request_compression = false
```

Codex 0.144.1 otherwise selects zstd for a streaming request when the stable
feature is enabled, the current ChatGPT authentication uses the Codex backend,
and the provider identifies as OpenAI. The pinned LiteLLM parser reads the body
directly as JSON and returns an empty object for unexpected decode failures; it
does not decode zstd first. The managed override is removed from gateway-only
layers, with any displaced user assignment restored byte-for-byte.
The gateway SSO provider uses the stable generated helper path and a separate
`GET /v1/models` catalog. In `both` mode, the launcher preserves the main
gateway config and never injects a profile; OAuth pass-through is explicit as
`opencode-litellm codex --profile codex-oauth`. In `oauth` mode the OAuth
provider is already the main config.

Gateway catalog generation inherits the prompt/model metadata template from the
listed, API-supported bundled row with the smallest numeric `priority` (lower
numbers win). It forces `use_responses_lite = false` on every generated gateway
row. OAuth catalog JSON is copied from `codex debug models --bundled` without
rewriting its fields.

Gateway catalog generation excludes models whose authoritative metadata marks
them as embedding, image-generation, or audio-only while retaining chat rows,
including multimodal chat rows. The exact Qwen preview row receives the
canonical `Qwen3.8 Max Preview` label, one-million-token context, and text/image
input modalities. Capabilities not verified for this route remain conservative:
reasoning levels are empty, while parallel-tool, search-tool, and
original-image-detail flags are `false`. Qwen remains below the reliable coding
default in priority.

## Cross-client assets

`InstallTarget.OpenCode`, `InstallTarget.Codex`, and `InstallTarget.Both` all
write the shared research skill at
`~/.agents/skills/litellm-research-router/SKILL.md`. Each selected target also
merges the Claude Skills Gateway marketplace into `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "litellm": {
      "source": {
        "source": "url",
        "url": "<normalized-origin>/claude-code/marketplace.json"
      }
    }
  }
}
```

The merge preserves unrelated settings and marketplace entries, writes mode
`0600`, and stores no credential. It registers marketplace infrastructure only;
it does not claim that the gateway currently publishes a plugin or skill. A
legacy flat entry is migrated to the nested source object, and a terminal
gateway `/v1` is stripped before `/claude-code/marketplace.json` is appended.

## Support and authentication matrix

| Component | Supported boundary | Notes |
|---|---|---|
| Node.js | `^22.22.2 || ^24.15.0 || >=26.0.0` | Required by both package manifests and the pinned OpenCode plugin dependency graph (`@opencode-ai/plugin@1.18.4` → `effect@4.0.0-beta.83` → `ini@7.0.0`) |
| Python / `lite` | Optional | Only needed if you independently use LiteLLM's Python CLI |
| LiteLLM gateway | Authenticated `/v1/models`, permission-filtered `/search_tools/list` with `/v1/search/tools` fallback, and optional MCP/toolset endpoints | Model discovery is required; optional surfaces degrade to warnings |
| Launch state | Schema-versioned, merged per-client state at `$XDG_CONFIG_HOME/opencode-litellm/launch.json` | Atomic `0600`; gateway/auth/config/search/mode metadata only; never a key or OAuth token |
| OpenCode | Releases supporting TypeScript `file://` plugins and documented provider/MCP/skill schemas | Restart after installation |
| Codex | Releases exposing the documented config fields and `codex debug models --bundled` | Re-run after Codex upgrades |
| macOS | Full installer path | Uses current-user `launchctl setenv` for OAuth mode; lifecycle logout uses `unsetenv` for the selected auth environment |
| Linux / WSL | Installer, discovery, and shell-based auth references | Export the selected gateway-key environment variable for OAuth mode |
| Native Windows | Config rendering paths | POSIX modes and `launchctl` are not applicable; release qualification remains pending |

The credential variable selected by `--auth-env` must be shell-compatible and
must not collide with launcher, provider-authentication, or process controls.
The installer rejects `CODEX_HOME`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_ENABLE_EXA`, `LITELLM_MASTER_KEY`, `LITELLM_BASE_URL`,
`LITELLM_PROXY_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
`OPENAI_BASE_URL`, `HOME`, `XDG_CONFIG_HOME`, `PATH`, and `NODE_OPTIONS` before
any client or launch-state write. `LITELLM_API_KEY` remains an explicitly
allowed neutral gateway variable. At child launch, ambient
`LITELLM_MASTER_KEY`, `LITELLM_API_KEY`, `LITELLM_PROXY_API_KEY`,
`OPENCODE_LITELLM_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`,
`ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` are scrubbed before the
selected transient credential is mapped to the target client.

| Client path | Gateway authentication | Upstream authentication | Persisted secret by this toolkit |
|---|---|---|---|
| OpenCode | In-memory exact-origin SSO `key` or selected environment variable | LiteLLM routing | None |
| Codex gateway | Command-backed SSO helper or selected environment variable | LiteLLM routing | None |
| Codex OAuth | `x-litellm-api-key` from an environment variable | Codex ChatGPT OAuth owns `Authorization` | None |
| Claude Code Max launcher | LiteLLM `/claude-max` admission header | Claude Code subscription OAuth | None; this is LiteLLM-documented, not an Anthropic-endorsed OAuth proxy |

## Managed fork and package status

The managed OpenCode checkout pin lives only in
`src/cli/managed-plugin-types.ts`. This documentation intentionally retains the
current pre-finalization pin; release qualification replaces it after the
runtime commit:

```text
83ea2674a8afb578a670188fb3b522fc242a77cb
```

Installation stages a clone/fetch/checkout at the full SHA, runs
`npm ci --ignore-scripts`, verifies origin/worktree/detached `HEAD`, and
atomically activates the revision-addressed directory. Existing active
revisions are verified in place; failed staging is removed without replacing
the active checkout.

| Package/bin | Manifest | Registry status at documentation time |
|---|---|---|
| `@happycastle114/opencode-litellm` / `opencode-litellm` and `codex-litellm` bins | Root `package.json`, version `0.6.0` | Release candidate; do not claim published |
| `codex-litellm` / `codex-litellm` bin | `packages/codex-litellm/package.json`, exact core dependency `0.6.0` | Release candidate; do not claim published |
| Unscoped `opencode-litellm` | Not owned by this project | Blocked by an unrelated existing publisher |

Until ownership and publication are verified, use the immutable GitHub checkout
and locally packed tarballs shown in the README.
