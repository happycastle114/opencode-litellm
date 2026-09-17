# Official sources and support matrix

Authentication and native-client contracts checked on 2026-09-17 for 0.8.0.
Runtime behavior is documented against the public
LiteLLM, OpenCode, Codex, Claude Code, and Oh My OpenAgent interfaces below.
GitHub source references use immutable commits where the implementation
contract matters.

## LiteLLM authentication and agent contracts

SSO uses the official LiteLLM CLI `1.101.0`, source commit
[`18243cd7`](https://github.com/BerriAI/litellm/tree/18243cd7af4c3325165ba68b21379e2719e051c7).
Install it with `uv tool install 'litellm[cli]==1.101.0'` and make `lite`
available on the invoking client's PATH. The upstream
[`cli` extra](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/pyproject.toml#L79-L91)
includes keyring support; it requires Python. [uv tool installation](https://docs.astral.sh/uv/guides/tools/)
manages an isolated Python environment.

The toolkit invokes native commands and captures their result. It does not
implement a second PKCE, browser, polling, renewal, or keyring flow. These
local CLI requirements do not change the operator's remote LiteLLM version.

| Contract | Immutable or official source | Toolkit behavior |
|---|---|---|
| PKCE login and logout | [`auth.py`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/commands/auth.py#L838-L973), [`main.py`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/main.py#L97-L101), [`cli_token_utils.py`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/litellm_core_utils/cli_token_utils.py#L149-L198) | Login passes `--api-key ''` before `login --pkce` to skip renewal of an old credential, then requires a newer native login stamp before token lookup. Native logout owns revocation and cleanup; missing metadata is an unverified store, not successful logout |
| Exact-origin token resolution and renewal | [`get_api_key`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/commands/auth.py#L235-L263) and [`print_token`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/commands/auth.py#L976-L1034) | Capture `lite --base-url <origin> auth print-token` in memory; never substitute an ambient key for an explicitly selected SSO session |
| Keyring and metadata storage | [`cli_token_utils.py`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/litellm_core_utils/cli_token_utils.py#L1-L10) and [`save_cli_token`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/litellm_core_utils/cli_token_utils.py#L149-L216) | Let upstream store secrets in the OS keyring and metadata in `~/.litellm/token.json`, with owner-only file fallback when a keyring is unavailable; do not bypass the native reader with a JSON `key` lookup |
| Agent environment conventions | [`agents.py`](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/client/cli/commands/agents.py) | Keep secret-free per-client launch intent; resolve the selected credential at launch and supply gateway/OAuth/MCP admission only to the child process; no `launchctl setenv` |
| Claude Max gateway admission | [`user_api_key_auth.py`](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/auth/user_api_key_auth.py#L121-L126) and its [scheme normalizer](https://github.com/BerriAI/litellm/blob/5d4c4d0fce45c73c4b56b48e46dfc4e56e8b0aa5/litellm/proxy/auth/user_api_key_auth.py#L260-L281) | Send `x-litellm-api-key: Bearer <key>`; the configured generic pass-through route authenticates through `user_api_key_auth`, which removes the scheme before key validation while preserving Claude OAuth in `Authorization` |

Manual API-key storage is a separate toolkit contract: `--auth env` accepts
the configured environment variable first, then an exact-origin saved key
from `~/.config/opencode-litellm/api-key.json`, or
`$XDG_CONFIG_HOME/opencode-litellm/api-key.json` when configured. The record
contains only `base_url` and `key`, with mode `0600` on POSIX. The official
CLI owns `~/.litellm/token.json` and its keyring entries; it may migrate
plaintext secrets from that file into the keyring. Manual API keys therefore
use a different file, not a marker in the SSO record.

Old manually entered keys require explicit re-entry with `--auth env`;
neither a `user_role` label nor the visible model list proves the credential
source. The toolkit does not infer or copy keys from the old shared store.
Official SSO records are resolved by `lite` instead.
Logout retains `launchctl unsetenv` cleanup for the selected legacy variable;
already running processes keep their inherited environment until restarted.

### Optional Auto Router boundary

The optional Auto Router keeps its separate PyPI pin `litellm[proxy]==1.98.0`,
source commit [`d8f71d7b`](https://github.com/BerriAI/litellm/tree/d8f71d7bdbd7c9873d98293f83d64c6db72847e6).
It requires `uv >= 0.10.9`, runs the
artifact with `uv tool run --isolated --from`, and verifies the CLI version and
`autoroute configure` subcommand before committing client files.
The checked [PyPI 1.98.0 artifact](https://pypi.org/project/litellm/1.98.0/#files)
reports CLI version `1.98.0` and publishes CPython 3.10+ wheels for Windows,
macOS, Linux glibc, and Linux musl on x86-64 and arm64. The toolkit therefore
does not require or install a Rust toolchain on those supported platforms.

| Contract | Immutable source | Toolkit behavior |
|---|---|---|
| Command surface and TTY requirement | [`commands.py`](https://github.com/BerriAI/litellm/blob/d8f71d7bdbd7c9873d98293f83d64c6db72847e6/litellm/proxy/client/cli/commands/autoroute/commands.py) | Invoke the official `configure` command only after explicit opt-in and a successful TTY preflight; never emulate its questions |
| Gateway discovery and secure config write | [`wizard.py`](https://github.com/BerriAI/litellm/blob/d8f71d7bdbd7c9873d98293f83d64c6db72847e6/litellm/proxy/client/cli/commands/autoroute/wizard.py) and [`config.py`](https://github.com/BerriAI/litellm/blob/d8f71d7bdbd7c9873d98293f83d64c6db72847e6/litellm/proxy/client/cli/commands/autoroute/config.py) | Supply `LITELLM_PROXY_URL` and `LITELLM_PROXY_API_KEY` only in the child environment; upstream reads authenticated `/v1/models` and writes `~/.litellm/autorouter/config.yaml` as `0600` |
| Local proxy lifecycle | [`process.py`](https://github.com/BerriAI/litellm/blob/d8f71d7bdbd7c9873d98293f83d64c6db72847e6/litellm/proxy/client/cli/commands/autoroute/process.py) | Use the pinned proxy extra; let upstream choose the port, run its proxy, and own PID/log lifecycle |
| Claude settings patch and restore | [`settings.py`](https://github.com/BerriAI/litellm/blob/d8f71d7bdbd7c9873d98293f83d64c6db72847e6/litellm/proxy/client/cli/commands/autoroute/settings.py) | Treat `up` as Claude-only configuration and direct operators to `down` for restoration |

The secret boundary is exact: the toolkit keeps the gateway key out of argv,
stdout/stderr and toolkit-owned files. The official wizard persists
the provider API key inside its own `0600` YAML. The toolkit does not mask or
replace that upstream behavior. After key rotation, operators must run the
pinned `down`, delete the YAML, refresh login/environment authentication, and
rerun `install --auto-router configure`.

The official LiteLLM public references used by the installer are:

- [Web Search interception](https://docs.litellm.ai/docs/integrations/websearch_interception),
  including `callbacks: ["websearch_interception"]`, configured `search_tools`,
  and conversion of native model search tools into LiteLLM's agentic search
  loop. Production validation also checks the running LiteLLM source for both
  Responses and Chat Completions interception handlers.
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
- [LiteLLM Model Catalog](https://api.litellm.ai/model_catalog), which is a
  public paginated reference catalog for provider metadata and capabilities.
  It is not authorization-aware and is never substituted for a gateway's
  authenticated model inventory.
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
| MCP toolsets | `GET /v1/mcp/toolset` | Optional; 404/405 and other failures become warnings | Available `/toolset/<url-encoded-name>/mcp` entries exposed by the gateway; invocation enforces gateway permissions |

LiteLLM v1.98.0 changed Auto Router discovery to authenticated `/v1/models`
([PR #34259](https://github.com/BerriAI/litellm/pull/34259)) and made routing
group names callable virtual models that are returned by `/v1/models`
([PR #36519](https://github.com/BerriAI/litellm/pull/36519)). The installer and
Codex catalog use this endpoint as the access-aware authority, preserving the
returned model ID and `mode`. The runtime OpenCode plugin may first enrich rows
from `/model_group/info` when the key has management access, but falls back to
`/v1/models` on denial or an invalid response.
Routing-group picker rows therefore depend on the remote gateway exposing that
v1.98-or-newer behavior; older compatible gateways continue to expose their
ordinary `/v1/models` inventory without being modified by this toolkit.

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

The SDK and plugin packages are pinned to `1.18.31`, matching the official
release source [`014614d3`](https://github.com/anomalyco/opencode/tree/014614d35b397775e5d397a490fc72368c894ec2).
The native [`provider.models` hook](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/plugin/src/index.ts#L210-L230)
exists, but the stable runtime calls it for providers already in its database
and skips unknown IDs. Config-only providers are registered afterward
([initialization order](https://github.com/anomalyco/opencode/blob/014614d35b397775e5d397a490fc72368c894ec2/packages/opencode/src/provider/provider.ts#L1454-L1481)).
Therefore custom `litellm` registration/discovery remains in the config hook.
The SDK's native `provider.list` and `config.providers` expose the registered
inventory; they do not discover an arbitrary LiteLLM gateway themselves.
See the [SDK reference](https://opencode.ai/docs/sdk/).

| Surface | Official documentation | Toolkit use |
|---|---|---|
| Local and npm plugins | [Plugins](https://opencode.ai/docs/plugins/) | Load a detached Git checkout through a `file://` entry; verify origin and full SHA before install |
| Config files | [Config](https://opencode.ai/docs/config/) | Prefer an existing `opencode.jsonc` over `opencode.json`; a custom path is preserved exactly in direct launch state |
| Providers and model picker | [Providers](https://opencode.ai/docs/providers) | Use `@ai-sdk/openai`, write a typed static discovered-model snapshot for immediate picker visibility, refresh live chat metadata during startup, and exclude known embedding/image-generation/audio-only rows while preserving multimodal chat rows |
| Search tools | [Tools](https://opencode.ai/docs/tools/) and [server tool inspection](https://opencode.ai/docs/server/) | Register `web-search` in the managed plugin for the active LiteLLM model; send a native Responses `web_search` request; keep named LiteLLM routes as `litellm_search`/`litellm_*`; never override the unrelated built-in `websearch`; scrub inherited `OPENCODE_ENABLE_EXA` at direct launch |
| Remote MCP | [MCP servers](https://opencode.ai/docs/mcp-servers/) | Register only gateway-discovered or explicitly selected server/toolset routes and preserve existing entries |
| Shared skills | [Agent skills](https://opencode.ai/docs/skills/) | Install one global `~/.agents/skills/litellm-research-router` skill |

OpenCode reads plugin options and runs the config hook at startup. Restart the
client after installation or after a gateway model/MCP catalog change. The
exact `alibaba-token/qwen3.8-max-preview` identifier is displayed as
`Qwen3.8 Max Preview`; generic models retain deterministic formatting.
Static installation is additive: existing curated model rows win on ID
collisions. Startup discovery prunes revoked LiteLLM rows when it obtains a
nonempty authorized list, while preserving explicit other-provider defaults.
The exact
legacy toolkit whitelist of six `alibaba-token/*` IDs is removed so all
discovered chat IDs can appear. Any other whitelist and every blacklist are
treated as user-owned and preserved.

The native search tool follows the published
[`opencode-websearch@0.6.0`](https://www.npmjs.com/package/opencode-websearch)
contract. Its immutable package source at commit
[`a87f729b`](https://github.com/emilsvennesson/opencode-websearch/tree/a87f729bc4ae83147d78078571e4275908627079)
selects the active OpenAI-compatible model and sends the configured provider a
Responses request containing `{ "type": "web_search" }`. The managed plugin
implements that LiteLLM-specific path directly so it can use its resolved
gateway credential and a stable API-client user agent. It preserves the
structured `{ query, results }` response, including deduplicated
`url_citation` title/URL pairs, and the mandatory Sources guidance from the
upstream tool description. The installer removes standalone
`opencode-websearch` pins to prevent duplicate `web-search` tools.

## Oh My OpenAgent consumer contract

OpenCode onboarding pins the official consumer package
[`oh-my-openagent@4.19.0`](https://registry.npmjs.org/oh-my-openagent/4.19.0).
The registry `gitHead` and GitHub `v4.19.0` tag both resolve to immutable commit
[`14083b89`](https://github.com/code-yeongyu/oh-my-openagent/tree/14083b89f1cbf4680be13493a6c4afd67c957e8a).
The published npm artifact has integrity
`sha512-Ov1a/V750SYoLHy6e6PHyUPaWyRGukjUDe5HzHqFMSKEx8IS0DUeT0EXGQIOO28/DSXE7TE4g82wVAi/UVX0zA==`.

The OpenCode integration retains this consumer pin with OpenCode SDK/plugin
`1.18.31`. The native startup test passes with `4.19.0`, including changed server
assignments and profile preservation after HTTP 401/503. The same test against
[`4.19.4`](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v4.19.4)
fails: the effective `explore` model is `litellm/student-auto` instead of the
server-assigned `litellm/gpt-5.6-luna`. The registry `gitHead` and release tag both
resolve to [`b072d279`](https://github.com/code-yeongyu/oh-my-openagent/tree/b072d279110bdda2c6ac2525d0d24dc54d16148a),
whose [plugin entry](https://github.com/code-yeongyu/oh-my-openagent/blob/b072d279110bdda2c6ac2525d0d24dc54d16148a/packages/omo-opencode/src/index.ts)
and [configuration loader](https://github.com/code-yeongyu/oh-my-openagent/blob/b072d279110bdda2c6ac2525d0d24dc54d16148a/packages/omo-opencode/src/plugin-config/omo-config-chain.ts)
use the newer module and unified OMO configuration contracts. A version-only
upgrade does not pass the toolkit's policy integration gate.
This does not change the separately installed Codex OMO version. The managed
OpenCode profile remains `oh-my-openagent.jsonc` / `oh-my-openagent.json`
(or the existing legacy `oh-my-opencode` filename), not a unified OMO config.

Policy discovery reads authenticated `/v1/models` and plain `/model/info`.
Do not add `include_team_models=true`: the live student endpoint returns the
required model metadata through the query-free endpoint; assignments remain
intersected with the authenticated `/v1/models` catalog.

| Contract | Immutable source | Toolkit behavior |
|---|---|---|
| Renamed and legacy config precedence | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) | Resolve renamed JSONC, renamed JSON, legacy JSONC, legacy JSON, then create renamed JSON beside the selected OpenCode config |
| Agent and category model overrides | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) and [schema](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/assets/oh-my-opencode.schema.json) | Apply authorized `student-auto.model_info.metadata.omo` assignments to managed LiteLLM agents/categories before OMO initialization; preserve external-provider slots, unrelated fields, and JSONC comments |
| Built-in MCP controls | [Configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/14083b89f1cbf4680be13493a6c4afd67c957e8a/docs/reference/configuration.md) | Preserve the managed OMA `websearch` profile setting separately from LiteLLM tool IDs; LiteLLM never registers the reserved OpenCode `websearch` name |

The installer replaces unversioned, differently versioned, and legacy
`oh-my-opencode` plugin entries with one exact `oh-my-openagent@4.19.0` entry.
It writes the active profile atomically as `0600`. Model assignment comes from
server policy instead of the retired Qwen-specific local assignment. An empty
server fallback list is rendered locally as the same primary model, preventing
OMO from inheriting a cross-provider fallback chain. The old local streaming
recovery model switching to Sol/Luna is retired; gateway routing owns model
fallback decisions. MCP collision handling remains independent of model policy
and LiteLLM search selection.

Legacy OMO files have no per-field ownership receipt. If a later login has no
OMO policy, the toolkit preserves ambiguous existing assignments rather than
guessing which manual values to delete. A `litellm/` prefix alone does not prove
that the toolkit owns an assignment.

## Codex contract

The 0.8.0 release target is official Codex CLI
[`0.154.0`](https://github.com/openai/codex/releases/tag/rust-v0.154.0).
Every successful gateway launch refresh reads the installed CLI's current
`codex debug models --bundled` output. Matching model slugs retain their own
native fields, including reasoning choices, shell behavior, context limits,
and modalities; gateway metadata overrides explicitly reported limits and
modalities. Unknown gateway slugs use the existing conservative fallback
profile. No previously generated catalog serves as the native template.

| Surface | Official documentation | Toolkit use |
|---|---|---|
| `model_catalog_json`, `model_provider`, `requires_openai_auth`, `env_http_headers`, and `forced_login_method` | [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) | Generate mutually exclusive gateway and ChatGPT OAuth provider auth sources plus startup catalogs |
| Custom providers and profiles | [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced) | Keep the gateway in `~/.codex/config.toml`; keep `codex-oauth` as a secondary profile in `both` mode |
| ChatGPT login | [Authentication](https://learn.chatgpt.com/docs/auth) | Codex owns the OAuth `Authorization` header and login lifecycle |
| Bundled model catalog | Codex CLI `codex debug models --bundled` | Copy the bundled catalog unchanged for OAuth; use a matching native model row for gateway models when available |
| Runtime inventory and account state | [App-server API](https://learn.chatgpt.com/docs/app-server) | Native `model/list` reports loaded models/capabilities; `account/read` and `account/login/start` own account inspection/login. Custom gateway catalogs still use the documented startup `model_catalog_json` setting |
| Command-backed provider authentication | [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) | Gateway SSO directly invokes `lite` with `auth.args` for exact-origin `auth print-token`; only saved manual keys use the toolkit file reader. Do not combine provider command auth with `env_key` or `requires_openai_auth` |
| Native web search | [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) | Mark gateway catalog rows `supports_search_tool: true`, set `web_search = "live"`, and send Codex's native Responses `web_search` tool through LiteLLM |
| Native OAuth request compression | Codex `0.154.0` [`EnableRequestCompression` default](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/features/src/lib.rs#L1220-L1225) and [zstd selector](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/client.rs#L1534-L1542); LiteLLM `1.101.0` [JSON body parser](https://github.com/BerriAI/litellm/blob/18243cd7af4c3325165ba68b21379e2719e051c7/litellm/proxy/common_utils/http_parsing_utils.py#L156-L182) | Retain the gateway compatibility override only in OAuth-active config layers, preserve other feature keys, and restore a pre-existing user value when the main config returns to gateway mode |
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

Codex 0.154.0 selects zstd for a streaming request when the stable
feature is enabled, the current ChatGPT authentication uses the Codex backend,
and the provider identifies as OpenAI. The cited LiteLLM body parser consumes
JSON bytes, so the toolkit retains its OAuth gateway compatibility override.
The managed override is removed from gateway-only
layers, with any displaced user assignment restored byte-for-byte.
The gateway SSO provider uses native command authentication directly:

```toml
[model_providers.litellm-gateway-sso.auth]
command = "lite"
args = ["--base-url", "https://gateway.example", "auth", "print-token"]
timeout_ms = 35000
```

Only saved manual-key mode installs the exact-file reader at
`~/.codex/libexec/litellm-auth-token.mjs`. Both modes use a separate
`GET /v1/models` catalog. In `both` mode, the launcher preserves the main
gateway config and never injects a profile; OAuth pass-through is explicit as
`opencode-litellm codex --profile codex-oauth`. In `oauth` mode the OAuth
provider is already the main config.

OAuth and authenticated MCP entries rely on the launcher's child-only gateway
admission environment. The toolkit does not export a key into launchd or the
user's shell configuration. Opening the desktop app icon does not execute this
launcher or supply its variables. Direct desktop gateway SSO can use native
command auth when `lite` is available to the app process.

The fallback for an unknown gateway model starts with the listed,
API-supported bundled row with the smallest numeric `priority`. Known native
models use their own rows. Generation forces `use_responses_lite = false` and
removes native service-tier/upgrade offers from gateway rows. OAuth catalog
JSON is copied from `codex debug models --bundled` without rewriting its fields.

Gateway launch refresh fails closed on authentication errors, empty/invalid
model lists, network errors, rate limits, server failures, or an unreadable
native catalog. It neither starts Codex with a stale list nor uses an old
account's generated fields. The previous file can remain on disk for recovery,
but a failed toolkit launch does not consume it. Already running clients and
desktop launches need a fresh install/restart to load a changed catalog.

Gateway catalog generation excludes models whose authoritative metadata marks
them as embedding, image-generation, or audio-only while retaining chat rows,
including multimodal chat rows. The exact Qwen preview row receives the
canonical `Qwen3.8 Max Preview` label, one-million-token context, and text/image
input modalities. Capabilities not verified for this route remain conservative:
reasoning levels are empty, while parallel-tool and
original-image-detail flags are `false`; search uses the gateway's native
interception path. Qwen remains below the reliable coding
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
| Node.js | `^22.22.2 || ^24.12.0 || >=26.0.0` | Required by both package manifests; also observe installed dependency engine requirements |
| Python / `lite` | Required for SSO | Install official `litellm[cli]==1.101.0`; upstream requires Python `>=3.10,<3.15`. API-key mode remains explicit and separate |
| `uv` | Recommended for official CLI installation; `>=0.10.9` for Auto Router | Persistent `uv tool install` makes `lite` available to clients. Auto Router retains its separate isolated `litellm[proxy]==1.98.0` pin |
| LiteLLM gateway | Authenticated `/v1/models`, permission-filtered `/search_tools/list` with `/v1/search/tools` fallback, and optional MCP/toolset endpoints | Model discovery is required; optional surfaces degrade to warnings |
| Launch state | Schema-versioned, merged per-client state at `$XDG_CONFIG_HOME/opencode-litellm/launch.json` | Atomic `0600`; gateway/auth/config/search/mode metadata only; never a key or OAuth token |
| OpenCode | SDK/plugin `1.18.31` | Config-hook registration preserves custom providers; restart after installation |
| Codex | Release target `0.154.0` | Native per-model catalog fields are refreshed before gateway CLI launch; re-run setup for desktop catalog updates |
| macOS | Native CLI/keyring and toolkit child environment | No `launchctl setenv`; logout clears the selected legacy launchd variable |
| Linux / WSL | Native CLI storage and toolkit child environment | Usable keyrings are preferred; official CLI reports owner-only file fallback when unavailable |
| Native Windows | Installer, native CLI, launcher, and `.bat` bootstrap | Install `lite` in the same Windows environment; WSL has separate credentials and paths |

The credential variable selected by `--auth-env` must be shell-compatible and
must not collide with launcher, provider-authentication, or process controls.
The installer rejects `CODEX_HOME`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_ENABLE_EXA`, `LITELLM_MASTER_KEY`, `LITELLM_BASE_URL`,
`LITELLM_PROXY_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
`OPENAI_BASE_URL`, `HOME`, `XDG_CONFIG_HOME`, `PATH`, and `NODE_OPTIONS` before
any client or launch-state write. `LITELLM_API_KEY` remains an explicitly
allowed neutral gateway variable. At child launch, the launcher clears its
ambient LiteLLM credential variables before mapping the selected credential.
Client-specific cleanup preserves the native authentication required by that
client; it is not a machine-wide deletion of unrelated provider credentials.

| Client path | Gateway authentication | Upstream authentication | Persisted secret by this toolkit |
|---|---|---|---|
| OpenCode | Official exact-origin SSO token or explicitly selected API key | LiteLLM routing | No SSO secret; manually entered keys use the separate owner-only `api-key.json` |
| Codex gateway | Direct native `lite` SSO command, manual-key reader, or selected environment variable | LiteLLM routing | No SSO secret; manually entered keys use the separate owner-only `api-key.json` |
| Codex OAuth | `x-litellm-api-key` from the toolkit child environment | Codex ChatGPT OAuth owns `Authorization` | No key in client config or launchd |
| Claude Code Max launcher | LiteLLM `/claude-max` admission header | Claude Code subscription OAuth | None; this is LiteLLM-documented, not an Anthropic-endorsed OAuth proxy |
| Official Auto Router wizard | Child-only `LITELLM_PROXY_URL` and `LITELLM_PROXY_API_KEY` | LiteLLM local proxy for Claude Code | None by this toolkit; the official CLI persists the provider key in `~/.litellm/autorouter/config.yaml` as `0600` |

## Managed fork and package status

The managed OpenCode checkout pin lives in
[`src/cli/managed-plugin-types.ts`](../src/cli/managed-plugin-types.ts).
Read that release's full SHA for its qualified runtime revision; a second copy
in this document would drift when the package is released.

Installation stages a clone/fetch/checkout at the full SHA, runs
`npm ci --ignore-scripts`, verifies origin/worktree/detached `HEAD`, and
atomically activates the revision-addressed directory. Existing active
revisions are verified in place; failed staging is removed without replacing
the active checkout.

The release workflow publishes both scoped packages to the public npm
registry at `https://registry.npmjs.org` using an automation-granular
`NPM_TOKEN` repository secret. The workflow uses `setup-node` with
`registry-url` and passes the token as `NODE_AUTH_TOKEN`. No user-level
npm configuration is used.

| Package/bin | Manifest | Registry status at documentation time |
|---|---|---|
| `@happycastle/opencode-litellm` / `opencode-litellm` and `codex-litellm` bins | Root `package.json`, public npmjs.org | Published; workflow verifies metadata and tarball identity before and after publish |
| `@happycastle/codex-litellm` / `codex-litellm` bin | `packages/codex-litellm/package.json`, exact core dependency | Published after the scoped core package |
| Unscoped `opencode-litellm` | Not owned by this project | Blocked by an unrelated existing publisher |

Packages are public on npmjs.org, so consumers need no authentication:

```sh
npx @happycastle/opencode-litellm install
npx @happycastle/codex-litellm install
```

## GPT-6 Astra (checked 2026-09-05)

[OpenAI's model reference](https://developers.openai.com/api/docs/models/gpt-6-astra)
sets a 1,050,000-token context window, 128,000 maximum output tokens, image
input, and reasoning efforts `low`, `medium`, `high`, `xhigh`, and `max`.
The shared profile fills missing discovery capabilities in both client model
selectors. OpenCode uses its existing `@ai-sdk/openai` Responses provider and
explicit effort variants; Codex advertises those efforts in its model catalog.
Existing explicit model choices remain selected. When the established router
aliases are absent, a newly generated Codex catalog prefers `gpt-6-astra`.
Provider setup follows [OpenCode's providers documentation](https://opencode.ai/docs/providers/)
and gateway discovery follows [LiteLLM model management](https://docs.litellm.ai/docs/proxy/model_management).

[GPT-5.6 Terra's model reference](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
checked 2026-09-05, specifies the same context/output limits and image input,
with reasoning efforts `none`, `low`, `medium` (default), `high`, `xhigh`, and
`max`. Both client selectors use the shared profile registry for Terra as well
as Astra; explicit Terra selections remain selected when Astra is available.

## Student automatic routing

When discovery returns exactly `student-auto`, `gpt-5.6-luna`,
`gpt-5.6-terra`, and `gpt-6-astra`, new student installs default to
`student-auto`. Reinstalling OpenCode also resets its default to this route;
manual direct model choices remain available in the client. Runtime discovery
preserves authorized manual choices and repairs absent or retired LiteLLM
selections. Retired LiteLLM picker entries are removed for this narrow catalog.
Broader owner catalogs retain their existing selection policy.

The router is gateway-owned and uses native Responses, including streaming.
Its client profile advertises the common 500,000-token context and 128,000-token
output limit. Clients send the public route unchanged; gateway routing and
classification internals are not client model entries.
