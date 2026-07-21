# LiteLLM client toolkit for OpenCode and Codex

This fork packages the OpenCode LiteLLM plugin and two onboarding binaries. The
installer configures model discovery, authorized search tools, MCP servers,
LiteLLM MCP toolsets, a shared research skill, and the Codex connection mode
you choose. It uses LiteLLM's documented SSO wire flow as a small Node.js
implementation, so the installer does not require Python or the `lite` CLI.

> Release status: `0.6.0` is a release candidate in this repository. The
> scoped package and the `codex-litellm` wrapper must not be described as
> published until npm ownership and publication are verified. The unscoped npm
> name `opencode-litellm` already belongs to another publisher.

The source contracts and support boundary are recorded in
[`docs/official-sources.md`](./docs/official-sources.md).

## What `install` configures

| Target | Managed result |
|---|---|
| OpenCode | A detached checkout of this fork at the full `MANAGED_PLUGIN.revision` SHA, a `file://` plugin entry, an `@ai-sdk/openai` provider, startup model discovery, authorized search tools, MCP discovery, and selected MCP toolsets |
| Codex | A gateway provider and model catalog, or a ChatGPT OAuth pass-through provider, or both profiles; selected MCP servers and toolsets are written to the managed Codex blocks |
| Both | The OpenCode and Codex results plus `~/.agents/skills/litellm-research-router/SKILL.md` |

The installer writes environment references and helper paths only. It never
writes the gateway key or a ChatGPT/Claude OAuth credential into client config.
OpenCode model and MCP discovery stays in memory at startup; Codex catalogs
are written as startup snapshots.

## Requirements

- Node.js 20 or newer, `npm`, and `git`.
- OpenCode and/or Codex installed for the selected target.
- A LiteLLM gateway reachable at the configured origin.

The built-in SSO flow stores a source-compatible token at
`~/.litellm/token.json` with POSIX mode `0600`. Python and LiteLLM's `lite`
executable are optional: the official CLI remains useful for independent
`whoami`/diagnostics, but is not a prerequisite for this toolkit.

## Install a fixed GitHub revision

Use a full release commit SHA, never a branch or `latest` selector:

```bash
export TOOLKIT_SHA='<full-40-character-release-commit-sha>'
git clone https://github.com/happycastle114/opencode-litellm.git
git -C opencode-litellm checkout --detach "$TOOLKIT_SHA"
cd opencode-litellm
npm ci
npm run build

export TOOLKIT_PACK_DIR="$(mktemp -d)"
npm pack --pack-destination "$TOOLKIT_PACK_DIR"
npm pack ./packages/codex-litellm --pack-destination "$TOOLKIT_PACK_DIR"
```

The core package owns both `opencode-litellm` and `codex-litellm` binaries; the
small `codex-litellm` package has an exact dependency on that same core
version. Use the filenames printed by `npm pack`:

```bash
export CORE_TGZ="$TOOLKIT_PACK_DIR/happycastle114-opencode-litellm-0.6.0.tgz"
export CODEX_TGZ="$TOOLKIT_PACK_DIR/codex-litellm-0.6.0.tgz"

# Binary name defaults to the target; --target both configures both clients.
npx --yes --package "$CORE_TGZ" opencode-litellm install
npx --yes --package "$CORE_TGZ" --package "$CODEX_TGZ" codex-litellm install
npx --yes --package "$CORE_TGZ" opencode-litellm install --target both

# Exact deterministic clean-HOME surface used by release qualification.
LITELLM_BASE_URL=https://llm.example.test \
LITELLM_PROXY_API_KEY='<gateway-key>' \
npx --yes --package "$CORE_TGZ" opencode-litellm install --non-interactive
```

After publication, use only package names and versions that have been checked
in the registry:

```bash
npx --yes --package @happycastle114/opencode-litellm@0.6.0 opencode-litellm install
npx --yes codex-litellm@0.6.0 install
```

There is intentionally no safe published command for the occupied unscoped
`opencode-litellm` name. A transfer or a new owned name is required before the
exact spelling `npx opencode-litellm install` can be used for this project.

## Onboarding, authentication, and agent launch

Interactive `install` asks for the target, gateway origin, authentication,
Codex mode, and the authorized search/MCP/toolset resources. Empty resource
selections mean “all visible resources”. Use `--non-interactive` for a
deterministic run with explicit values and an existing credential.
In that mode, `LITELLM_BASE_URL` (or the official CLI-compatible
`LITELLM_PROXY_URL`) supplies the gateway when `--base-url` is absent. A
non-empty variable named by `--auth-env` selects environment authentication
when `--auth` is absent. Explicit flags always win; interactive onboarding
continues to default to SSO.

The default authentication is the built-in LiteLLM SSO flow:

```bash
opencode-litellm login --base-url https://llm.soungmin.kr
opencode-litellm whoami --base-url https://llm.soungmin.kr
opencode-litellm install
opencode-litellm logout --base-url https://llm.soungmin.kr
```

The implementation follows LiteLLM's CLI-compatible sequence: `POST
/sso/cli/start`, browser verification at the returned same-origin URL (or
`/sso/key/generate?source=litellm-cli&key=...`), polling
`/sso/cli/poll/<login_id>` with `x-litellm-cli-poll-secret`, optional team
selection, and an atomic `0600` token write. `whoami` reports only local,
non-secret metadata. An interactive install retries this SSO flow once when a
stored token is rejected with HTTP 401/403; non-interactive runs fail closed.
On macOS, a completed install synchronizes the SSO gateway key into the current
`launchd` session when a Codex OAuth profile is selected, so the Codex desktop
app can resolve `env_http_headers`. A later `login` refreshes that value when
the helper already exists, and `logout` removes both the token file and the
selected environment name. Pass the same custom name to lifecycle commands
when `--auth-env` is not the default:

```bash
opencode-litellm logout --auth-env CUSTOM_LITELLM_KEY
```

The direct agent commands keep credentials in the child process environment
only:

```bash
opencode-litellm claude [claude-args...]
opencode-litellm codex [codex-args...]
opencode-litellm opencode [opencode-args...]
```

- Claude Code is routed through the LiteLLM `/claude-max` path with
  `ANTHROPIC_CUSTOM_HEADERS=x-litellm-api-key: Bearer <key>`. Existing
  Anthropic API/auth variables are removed so Claude's own subscription OAuth
  remains authoritative. This is the official Claude Code Max flow, not an
  OpenCode Max OAuth plugin.
- Codex receives a transient `LITELLM_PROXY_API_KEY`; `CODEX_API_KEY`,
  `OPENAI_API_KEY`, and `OPENAI_BASE_URL` are removed.
- OpenCode receives `LITELLM_PROXY_URL`; secret-bearing gateway variables are
  removed and the plugin reads the exact-origin SSO token in memory.

## Codex modes and model picker

Choose one with `--codex-mode gateway|oauth|both` (the default is `both`):

| Mode | Main config | OAuth profile | Model catalog |
|---|---|---|---|
| `gateway` | `~/.codex/config.toml` uses `litellm-gateway-sso` and the command auth helper | Retired | `~/.codex/litellm-models.json` from authenticated `GET /v1/models` |
| `oauth` | `~/.codex/config.toml` uses `litellm-codex-oauth` | Retired | `~/.codex/litellm-codex-oauth-models.json` from `codex debug models --bundled` |
| `both` | Main config uses gateway SSO | `~/.codex/codex-oauth.config.toml` | Both catalogs are kept |

The OAuth provider uses `base_url = <gateway>/codex-oauth`,
`wire_api = "responses"`, `requires_openai_auth = true`,
`forced_login_method = "chatgpt"`, and
`env_http_headers = { "x-litellm-api-key" = "LITELLM_PROXY_API_KEY" }`.
Codex owns the `Authorization` header; the gateway admission key is separate.
The provider never combines `requires_openai_auth` with `env_key` or command
auth. In `both` mode, start the pass-through profile explicitly:

```bash
codex login status
codex --profile codex-oauth
```

The catalog is regenerated after a Codex upgrade so new models appear in the
picker. The gateway catalog uses the live LiteLLM IDs, preserves a valid
default, and contains no plaintext key.

## Discovery, search tools, MCP, and toolsets

Install discovery authenticates once, then requests the model catalog and
optional tool surfaces concurrently:

| Surface | Gateway endpoint | Registration |
|---|---|---|
| Models | `GET /v1/models` (required) | OpenCode picker at startup; Codex JSON catalog |
| Search tools | `GET /search_tools/list` | OpenCode plugin `searchTools`; first selected tool is exposed as `websearch`, additional tools retain their names |
| MCP servers | `GET /v1/mcp/server` | Deployed-gateway-compatible `/<server_name>/mcp` remote entries |
| MCP toolsets | `GET /v1/mcp/toolset` | Official `/mcp/<url-encoded-toolset-name>` remote entries |

Empty `--search`, `--mcp`, or `--toolset` lists select every resource returned
for the current key. Restrict or disable surfaces with:

```bash
opencode-litellm install --search agy-search --search exa-search
opencode-litellm install --mcp zread --disable-mcp minimax_search
opencode-litellm install --toolset research-core
opencode-litellm install --no-search --no-mcp --no-toolsets
```

Search calls use LiteLLM's documented `POST /v1/search/<search_tool_name>` API,
send `Authorization: Bearer <key>`, and expose `query`, `max_results` (1–20),
and `search_domain_filter`. Optional search/MCP/toolset endpoint failures are
reported as warnings; a missing or unauthorized model catalog stops install.

MCP toolsets are LiteLLM's named, permissioned collections of tools from one or
more MCP servers. The installer discovers and registers the named runtime
route; it does not invent tools or copy tool definitions into client config.
LiteLLM's separate MCP Tool Search feature (`mcp_tool_search`/
`mcp_tool_call`) is controlled by the gateway key's `object_permission` (for
example `mcp_tool_search_enabled`) and is not silently enabled by this
installer. Configure that server-side permission separately when needed.

The shared skill is installed at `~/.agents/skills/litellm-research-router` and
is available to both clients. Restart OpenCode and Codex after installation so
their startup hooks/catalog readers run again.

## Flags and readback

```text
--target <opencode|codex|both>
--base-url <url>
--auth <sso|env>
--auth-env <NAME>
--codex-mode <gateway|oauth|both>
--search <name>       (repeatable)
--mcp <name>          (repeatable)
--toolset <name>      (repeatable)
--disable-mcp <name>  (repeatable)
--no-search | --no-mcp | --no-toolsets
--non-interactive
--opencode-config <path> | --codex-config <path>
```

Without overrides, an existing `opencode.jsonc` is preferred over
`opencode.json`; Codex uses `~/.codex/config.toml`. Use the doctor command to
check the resulting shape and auth boundaries:

```bash
opencode-litellm doctor --target both --json
opencode models litellm
codex debug models --bundled
```

## Managed checkout, backups, and recovery

The installer source of truth is `MANAGED_PLUGIN.revision` in
`src/cli/managed-plugin.ts`. The release candidate currently records:

```text
23ee802a819e6d8eadf4e03b00eb3f0af50d525d
```

Installation verifies the expected GitHub origin, a full 40-character SHA, a
clean checkout, and detached `HEAD`, then runs `npm ci --ignore-scripts` when a
lockfile exists. This revision is intentionally not changed by documentation
updates; changing it is a release operation after the runtime commit is
published and re-tested.

Config writes use a temporary file and atomic rename. Existing files are backed
up only when bytes change. Generated assets include:

```text
<OpenCode config dir>/vendor/opencode-litellm-git/
~/.codex/litellm-models.json
~/.codex/litellm-codex-oauth-models.json
~/.codex/codex-oauth.config.toml
~/.codex/libexec/litellm-auth-token.mjs
~/.agents/skills/litellm-research-router/
```

There is no `uninstall` command in this release candidate. Restore the newest
backup before removing managed entries; remove the shared skill only when no
other client uses it. `opencode-litellm logout` removes the local SSO token and,
on macOS, clears the selected Codex OAuth admission-key environment from the
current `launchd` session.

## Development

```bash
npm ci
npm run typecheck
npm test
```

The fork retains the MIT license and builds on the original
[`yuseferi/opencode-litellm`](https://github.com/yuseferi/opencode-litellm)
plugin.
