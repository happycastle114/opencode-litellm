# LiteLLM client toolkit for OpenCode and Codex

This fork packages the OpenCode LiteLLM plugin and two onboarding binaries. The
installer configures model discovery, available search tools, MCP servers,
LiteLLM MCP toolsets, a shared research skill, and the Codex connection mode
you choose. Its core path uses LiteLLM's documented SSO wire flow as a small
Node.js implementation, so normal installs do not require Python or the `lite`
CLI. Optional Auto Router onboarding delegates to one pinned official LiteLLM
CLI instead of reproducing that feature.

> Distribution names: the core package is
> `@happycastle114/opencode-litellm`, and the convenience wrapper is
> `@happycastle114/codex-litellm` (which installs the `codex-litellm` binary).
> The unscoped npm name `opencode-litellm` belongs to another publisher and is
> not a distribution channel for this project.

The source contracts and support boundary are recorded in
[`docs/official-sources.md`](./docs/official-sources.md).

## What `install` configures

| Target | Managed result |
|---|---|
| OpenCode | A detached, revision-addressed checkout of this fork, a `file://` plugin entry, an `@ai-sdk/openai` provider, an immediate model-picker snapshot plus startup refresh, available search-tool inventory, MCP discovery, selected MCP toolsets, and the shared `~/.agents/skills/litellm-research-router/SKILL.md` |
| Codex | A gateway provider and model catalog, or a ChatGPT OAuth pass-through provider, or both profiles; selected MCP servers and toolsets are written to the managed Codex blocks, together with the shared `~/.agents/skills/litellm-research-router/SKILL.md` |
| Both | The OpenCode and Codex results, with one shared `~/.agents/skills/litellm-research-router/SKILL.md` asset |

The installer writes environment references and helper paths only. It never
writes the gateway key or a ChatGPT/Claude OAuth credential into client config.
OpenCode writes an additive model snapshot so the picker is populated before
plugin startup, then refreshes models in memory at startup. MCP discovery stays
in memory. Codex catalogs are written as startup snapshots.

Every selected target also merges the Claude Skills Gateway marketplace into
`~/.claude/settings.json` under the stable `extraKnownMarketplaces.litellm` key:

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

Existing settings and marketplace entries are preserved, the file is written
with mode `0600`, and no credential is stored. The marketplace asset is shared
by OpenCode-only, Codex-only, and Both installs. This registers marketplace
infrastructure only; it does not claim that the gateway currently publishes or
installs any marketplace plugin or skill. Existing legacy flat `source`/`url`
entries are migrated to Claude Code's nested source object, and a terminal
gateway `/v1` is removed before `/claude-code/marketplace.json` is appended.

## Requirements

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, `npm`, and `git`.
- OpenCode and/or Codex installed for the selected target.
- A LiteLLM gateway reachable at the configured origin.
- Optional Auto Router setup requires `uv` 0.10.9 or newer. The toolkit runs
  the exact `litellm[proxy]==1.94.0rc1` artifact in an isolated `uv tool`
  environment; it does not use an ambient `lite` installation.

A source checkout also needs Bun 1.x for `npm run build`; this is a maintainer
build prerequisite only. Packed npm artifacts ship prebuilt Node-compatible
`dist` files and do not invoke Bun at install or runtime.

The built-in SSO flow stores a source-compatible token at
`~/.litellm/token.json` with POSIX mode `0600`. Python and LiteLLM's `lite`
executable are optional for the normal toolkit path. They are needed only when
the operator opts into Auto Router, where `uv` resolves the pinned official CLI
and its proxy extra.

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
small `@happycastle114/codex-litellm` package has an exact dependency on that
same core version. Use the filenames printed by `npm pack`:

```bash
export CORE_TGZ="$TOOLKIT_PACK_DIR/happycastle114-opencode-litellm-0.7.0.tgz"
export CODEX_TGZ="$TOOLKIT_PACK_DIR/happycastle114-codex-litellm-0.7.0.tgz"

# Binary name defaults to the target; --target both configures both clients.
npx --yes --package "$CORE_TGZ" opencode-litellm install
npx --yes --package "$CORE_TGZ" --package "$CODEX_TGZ" codex-litellm install
npx --yes --package "$CORE_TGZ" opencode-litellm install --target both

# Exact deterministic clean-HOME surface used by release qualification.
LITELLM_BASE_URL=https://llm.example.test \
LITELLM_PROXY_API_KEY='<gateway-key>' \
npx --yes --package "$CORE_TGZ" opencode-litellm install --non-interactive
```

## Install from GitHub Packages

The release packages are published to GitHub Packages, not npmjs.org. GitHub
Packages requires authentication for npm reads even when a package is public.
Use an ephemeral npm config and an environment token; this does not touch a
user-level `.npmrc`, Keychain, or a client config file:

```bash
export TOOLKIT_VERSION='0.7.0'
export NODE_AUTH_TOKEN='<GitHub classic PAT with read:packages>'
export NPM_CONFIG_USERCONFIG="$(mktemp)"
umask 077
printf '%s\n' \
  '@happycastle114:registry=https://npm.pkg.github.com' \
  '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' \
  'always-auth=true' > "$NPM_CONFIG_USERCONFIG"

# The package installs the opencode-litellm binary.
npx --yes --package "@happycastle114/opencode-litellm@${TOOLKIT_VERSION}" opencode-litellm install

# The wrapper installs the codex-litellm binary and its exact core dependency.
npx --yes --package "@happycastle114/codex-litellm@${TOOLKIT_VERSION}" codex-litellm install
```

Remove the temporary config after use with `rm -f "$NPM_CONFIG_USERCONFIG"`.
Pin a full version as shown above; do not use an unversioned or `latest`
selector for a release qualification.

There is intentionally no safe published command for the occupied unscoped
`opencode-litellm` name. A transfer or a new owned name is required before the
exact spelling `npx opencode-litellm install` can be used for this project.

## Onboarding, authentication, and agent launch

Interactive `install` is one onboarding flow for the target, gateway origin,
authentication (`sso` or `env`), Codex connection mode (`gateway`, `oauth`, or
`both`), and discovered search/MCP/toolset resources. Empty selections use all
rows returned by each discovery surface. Search discovery is an available-tool
inventory, not proof that the current key may invoke every listed tool. Use
`--non-interactive` for a deterministic run with explicit values and an
existing credential. Non-interactive installs skip Auto Router unless
`--auto-router configure` or `--auto-router dry-run` is explicit.
In that mode, `LITELLM_BASE_URL` (or the official CLI-compatible
`LITELLM_PROXY_URL`) supplies the gateway when `--base-url` is absent. A
non-empty variable named by `--auth-env` selects environment authentication
when `--auth` is absent. Explicit flags always win; interactive onboarding
continues to default to SSO.

### Optional Auto Router for Claude Code

Interactive onboarding offers an opt-in LiteLLM Auto Router step. It affects
Claude Code only; the OpenCode and Codex configurations described elsewhere in
this README are unchanged. The same choice is available on both binaries:

```bash
opencode-litellm install --auto-router configure
codex-litellm install --auto-router configure
opencode-litellm install --non-interactive --auto-router dry-run
```

`configure` requires a TTY. Before changing any client file, the installer
checks `uv >= 0.10.9`, verifies the pinned CLI reports version `1.94.0rc1`, and
checks that `autoroute configure` exists. After the client transaction commits,
it runs the official wizard as:

```text
uv tool run --isolated --from 'litellm[proxy]==1.94.0rc1' lite autoroute configure
```

The gateway origin and key are supplied only to that child process as
`LITELLM_PROXY_URL` and `LITELLM_PROXY_API_KEY`. The toolkit never places the
key in argv, logs, its own config files, or Keychain. The upstream wizard calls
`/model_group/info` and writes `~/.litellm/autorouter/config.yaml` with mode
`0600`. That official file contains the provider API key. This persistence is
an upstream Auto Router behavior, not a secret store owned by this toolkit.

Start and stop the pinned official proxy with:

```bash
uv tool run --isolated --from 'litellm[proxy]==1.94.0rc1' lite autoroute up
uv tool run --isolated --from 'litellm[proxy]==1.94.0rc1' lite autoroute down
```

`up` chooses its local port and patches Claude settings; this pin does not
accept a toolkit-supplied `--port`. `down` restores the saved Claude settings.
After a gateway-key rotation, run `down`, delete
`~/.litellm/autorouter/config.yaml`, sign in or refresh the environment key,
then rerun `install --auto-router configure`. `--auto-router dry-run` prints the
exact secret-free command plan and performs no Auto Router subprocess calls.

PyPI currently publishes `1.94.0rc1` binary wheels for Linux only. On macOS,
Windows, and other non-Linux platforms, the installer explicitly checks
`rustc --version` and `cargo --version` before `uv` builds the official sdist.
A missing toolchain fails before client files are changed; the installer never
installs Rust automatically.

`--auth-env` accepts a shell-compatible variable name but rejects names owned
by the launcher, provider authentication, or process runtime:
`CODEX_HOME`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_ENABLE_EXA`, `LITELLM_MASTER_KEY`, `LITELLM_BASE_URL`,
`LITELLM_PROXY_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
`ANTHROPIC_CUSTOM_HEADERS`, `OPENAI_BASE_URL`, `HOME`, `XDG_CONFIG_HOME`,
`PATH`, and `NODE_OPTIONS`. `LITELLM_API_KEY` is intentionally allowed as a
neutral, default-compatible gateway variable. Rejection happens before client
configuration or launch state is changed.

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

Each successful install records a secret-free launch intent with POSIX mode
`0600` at
`$XDG_CONFIG_HOME/opencode-litellm/launch.json`, or
`~/.config/opencode-litellm/launch.json`. The direct agent commands load that
exact per-client gateway, authentication mode, environment-variable name,
client config path, search state, and Codex mode. OpenCode-only and Codex-only
installs merge with the previously installed client state instead of replacing
it; the most recent install supplies the shared Claude launch state. The file
contains no key or OAuth token, and credentials remain in the child process
environment only:

```bash
opencode-litellm claude [claude-args...]
opencode-litellm codex [codex-args...]
opencode-litellm opencode [opencode-args...]
```

- Claude Code is routed through the LiteLLM `/claude-max` path with
  `ANTHROPIC_CUSTOM_HEADERS=x-litellm-api-key: Bearer <key>`. Existing
  Anthropic API/auth variables and the configured LiteLLM key variable are
  removed so Claude's own subscription OAuth remains authoritative. This is
  intentional: the pinned generic pass-through authentication dependency
  removes the single `Bearer` scheme before validating the LiteLLM key while
  leaving Claude's separate OAuth `Authorization` header untouched. This is
  LiteLLM's documented Claude Code Max pass-through flow. Anthropic documents
  the general `ANTHROPIC_BASE_URL` LLM-gateway boundary, but does not document
  this Max OAuth proxy as an Anthropic-supported integration. It is not an
  OpenCode Max OAuth plugin.
- Codex receives the gateway key only under the environment-variable name
  selected at install; `CODEX_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_BASE_URL`
  are removed. The launcher never injects a profile: `both` mode starts the
  main gateway config unless the caller explicitly supplies
  `--profile codex-oauth`; `oauth` mode needs no profile because its main config
  is already OAuth-backed.
- OpenCode receives `LITELLM_PROXY_URL`, a child-scoped
  `OPENCODE_LITELLM_API_KEY`, the selected gateway environment variable, and the
  exact configured `OPENCODE_CONFIG` path. The launcher scrubs inherited
  `OPENCODE_ENABLE_EXA` and never sets it. Selected search tools use the
  non-reserved IDs `litellm_search` (first) and deterministic `litellm_*` names
  for additional tools; the built-in `websearch` ID is never overridden.

An OpenCode install also writes the discovered chat-capable model snapshot into
the static `provider.litellm.models` registry, so the next picker can expose
gateway models before the startup plugin hook completes. Discovery metadata is
mapped through the same typed adapter used by the hook. Existing curated model
objects win on ID collisions, and unreturned existing rows are retained rather
than silently pruned. A legacy toolkit-managed whitelist is removed only when
it exactly matches the old six `alibaba-token/*` entries; user-defined
whitelists and every blacklist are preserved. Subsequent installs refresh the
discovered snapshot additively, while runtime discovery can still add current
gateway rows.

At every direct-launch boundary, ambient `LITELLM_MASTER_KEY`,
`LITELLM_API_KEY`, `OPENCODE_LITELLM_API_KEY`, and `LITELLM_PROXY_API_KEY` are
scrubbed before the selected child-only credential is set. Provider credentials
are scrubbed for the relevant client as well (`OPENAI_API_KEY`, `CODEX_API_KEY`,
`ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN`); the parent environment is not
mutated.

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
auth. Native Codex and the toolkit launcher start the pass-through profile only
when it is selected explicitly in `both` mode:

```bash
codex login status
codex --profile codex-oauth
opencode-litellm codex --profile codex-oauth
```

Codex 0.144.1 enables zstd request compression by default for native ChatGPT
OAuth requests. The pinned LiteLLM `1.94.0-rc.1` generic pass-through parses
the incoming bytes as JSON without decoding `Content-Encoding: zstd`, so an
encoded request can reach the upstream route as an empty object. The installer
therefore manages `[features].enable_request_compression = false` in the active
OAuth config: the main config in `oauth` mode and `codex-oauth.config.toml` in
`both` mode. Gateway-only configs do not retain that override. If a user had an
explicit value before switching to OAuth, a later gateway transition restores
that exact line instead of discarding the preference.

Gateway catalogs inherit the prompt/model metadata template from
`codex debug models --bundled`: among listed, API-supported rows, the smallest
numeric `priority` wins. Gateway rows force `use_responses_lite = false` and
retain the inherited prompt fields. OAuth mode copies the bundled catalog
unchanged, so it remains the exact Codex-provided snapshot.

The catalog is regenerated after a Codex upgrade so new models appear in the
picker. The gateway catalog uses the live LiteLLM IDs, excludes rows identified
as embedding, image-generation, or audio-only models, preserves multimodal chat
rows, keeps a reliable coding model as the default, and contains no plaintext
key. The exact `alibaba-token/qwen3.8-max-preview` row is shown as
`Qwen3.8 Max Preview` with a one-million-token context window and text/image
input modalities, but is not promoted over the reliable default. Unverified
capabilities stay conservative: reasoning levels are empty and parallel-tool,
search-tool, and original-image-detail support remain `false`.

## Discovery, search tools, MCP, and toolsets

Install discovery authenticates once, then requests the model catalog and
optional tool surfaces concurrently:

| Surface | Gateway endpoint | Registration |
|---|---|---|
| Models | `GET /v1/models` (required) | OpenCode picker at startup; Codex JSON catalog |
| Search tools | Primary `GET /search_tools/list` (permission-filtered); fallback `GET /v1/search/tools` (`{ "object": "list", "data": [...] }`) | Permission-filtered names are preferred. A successful router-wide fallback emits a typed warning; selected names become OpenCode `searchTools` with non-reserved `litellm_*` IDs |
| MCP servers | `GET /v1/mcp/server` | Deployed-gateway-compatible `/<server_name>/mcp` remote entries |
| MCP toolsets | `GET /v1/mcp/toolset` | Pinned `v1.94.0-rc.1` `/toolset/<url-encoded-toolset-name>/mcp` remote entries |

Empty `--search`, `--mcp`, or `--toolset` lists select every row returned by the
corresponding discovery endpoint. Search discovery first requests the
permission-filtered `GET /search_tools/list` route. If that route is unavailable,
unsupported, or returns an invalid shape, discovery falls back to
`GET /v1/search/tools`; that fallback is router-wide and produces a typed
available-inventory warning (`available_fallback`). LiteLLM still enforces the
current key's object permissions when OpenCode invokes
`POST /v1/search/<search_tool_name>`.

The first selected search is registered as `litellm_search`. Additional names
are normalized to deterministic `litellm_<name>` IDs (hyphens become
underscores) with numeric suffixes for collisions; the reserved `websearch` ID
is never used.

If optional search or toolset discovery is unavailable, an explicitly named
`--search` or `--toolset` is retained in configuration with an “unverified”
warning. When available inventory is returned, an unknown name is skipped, but
presence in that inventory still is not an authorization guarantee. Restrict,
disable, or override MCP startup state with:

```bash
opencode-litellm install --search agy-search --search semantic-search
opencode-litellm install --mcp zread --disable-mcp zread
opencode-litellm install --enable-mcp minimax_search
opencode-litellm install --toolset research-core
opencode-litellm install --no-search --no-mcp --no-toolsets
```

`minimax_search` is selected when returned by MCP discovery but starts disabled
by default; `--enable-mcp minimax_search` is the explicit escape hatch. State
flags do not add a server to a narrowed `--mcp` selection, so use both
`--mcp minimax_search --enable-mcp minimax_search` when selecting only that
server. `zread`, `zai_web_reader`, and otherwise unknown MCP names default to
enabled unless explicitly disabled.

Search calls use LiteLLM's documented `POST /v1/search/<search_tool_name>` API,
send `Authorization: Bearer <key>`, and expose `query`, `max_results` (1–20),
and `search_domain_filter`. The POST response is the real permission check;
listing a tool during onboarding does not pre-authorize it. Optional
search/MCP/toolset endpoint failures are reported as warnings; a missing or
unauthorized model catalog stops install.

MCP toolsets are LiteLLM's named, permissioned collections of tools from one or
more MCP servers. The installer discovers and registers the named runtime
route; it does not invent tools or copy tool definitions into client config.
LiteLLM's separate MCP Tool Search feature (`mcp_tool_search`/
`mcp_tool_call`) is controlled by the gateway key's `object_permission` (for
example `mcp_tool_search_enabled`) and is not silently enabled by this
installer. Configure that server-side permission separately when needed.

The shared skill is installed at `~/.agents/skills/litellm-research-router` for
every selected target (`opencode`, `codex`, or `both`) and is available to both
clients. Restart OpenCode and Codex after installation so their startup
hooks/catalog readers run again.

## Qwen and Oh My OpenAgent routing

OpenCode onboarding pins the official consumer plugin as
`oh-my-openagent@4.19.0`, replacing unversioned, differently versioned, or
legacy `oh-my-opencode` entries without duplication. It resolves the active
user profile in this migration-safe order: renamed JSONC, renamed JSON, legacy
JSONC, legacy JSON, then a new renamed JSON file. JSONC comments and unrelated
fields are preserved. The managed profile remains an atomic `0600` file and
contains no credential.

When the exact gateway model `alibaba-token/qwen3.8-max-preview` is visible,
the installer writes the provider-qualified OpenCode route
`litellm/alibaba-token/qwen3.8-max-preview` only to these bounded entries:

- Agents: `sisyphus-junior`, `prometheus`, `plan`, `librarian`, `explore`,
  `document-writer`, and `multimodal-looker`.
- Categories: `writing` and `long-context`.

High-difficulty and visual-engineering routes outside that list remain
user-managed. If Qwen is absent, no Qwen route is invented and the installer
warns. LiteLLM search IDs remain non-reserved and never replace OpenCode's
built-in `websearch`, independent of Qwen discovery and even with `--no-search`.

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
--enable-mcp <name>   (repeatable; overrides a selected server's default state)
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

The installer source of truth is `MANAGED_OPEN_CODE_PLUGIN.revision` in
`src/cli/managed-plugin-types.ts`. This release records the qualified runtime
commit:

```text
f97a800d7ce1dd204a2cfe0c51b7149428ecdff4
```

Installation stages a clone/fetch/checkout at the full 40-character SHA, runs
`npm ci --ignore-scripts`, verifies origin/worktree/`HEAD`, and atomically
activates the revision-addressed directory. An existing active revision is
verified in place; a failed staged install is removed without replacing it.
The following release-metadata commit does not change runtime behavior, so the
managed checkout remains pinned to the qualified runtime commit above.

Client assets are staged under cryptographic per-transaction UUID names. While
the installer process is running, promotion is all-or-nothing and existing
files are backed up only when bytes change. A forced process kill is not a
cross-file atomic boundary: if it happens after an original file is moved but
before its replacement is linked, the exact original remains at the clearly
recognizable recovery path `<destination>.<uuid>.rollback.tmp`. A rerun uses a
new UUID, converges without clobbering that recovery file, and prints its path
as a warning. Verify the active destination before manually removing a recovery
file. Generated assets include:

Interactive install keeps a newly issued SSO credential deferred until the
managed plugin is ready, then promotes the `0600` token in the same filesystem
transaction as client and launch state. Cancelling onboarding or failing plugin
preparation leaves the previous token untouched. Explicit destinations shared
by different HOME values use exact source identity and byte validation during
promotion, so a stale concurrent writer fails without overwriting the winner.

The per-home lease coordinates this toolkit's `install`, `login`, and `logout`
writers. `whoami` is read-only. Direct file edits and external LiteLLM CLI
commands do not participate in the lease; they are treated as non-cooperating
editors, and managed-file identity checks fail closed when they overlap an
installation.

```text
~/.litellm/token.json (only when interactive install issues a fresh SSO token)
<OpenCode config dir>/vendor/opencode-litellm-git/f97a800d7ce1dd204a2cfe0c51b7149428ecdff4/
<active OpenCode config dir>/oh-my-openagent.json[c] (or existing legacy oh-my-opencode.json[c])
$XDG_CONFIG_HOME/opencode-litellm/launch.json
~/.codex/litellm-models.json
~/.codex/litellm-codex-oauth-models.json
~/.codex/codex-oauth.config.toml
~/.codex/libexec/litellm-auth-token.mjs
~/.agents/skills/litellm-research-router/
~/.claude/settings.json
```

There is no `uninstall` command in this release. Restore the newest
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
