# @happycastle114/codex-litellm

`@happycastle114/codex-litellm` is the thin Codex-focused wrapper for
[`@happycastle114/opencode-litellm`](https://github.com/happycastle114/opencode-litellm).
It forwards commands to the core CLI and makes `install` target Codex by
default.

## Usage

```bash
export NODE_AUTH_TOKEN='<GitHub classic PAT with read:packages>'
export NPM_CONFIG_USERCONFIG="$(mktemp)"
umask 077
printf '%s\n' \
  '@happycastle114:registry=https://npm.pkg.github.com' \
  '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' \
  'always-auth=true' > "$NPM_CONFIG_USERCONFIG"

npx --yes --package @happycastle114/codex-litellm@0.7.0 codex-litellm install
npx --yes --package @happycastle114/codex-litellm@0.7.0 codex-litellm install --target both
npx --yes --package @happycastle114/codex-litellm@0.7.0 codex-litellm install --auto-router configure
npx --yes --package @happycastle114/codex-litellm@0.7.0 codex-litellm whoami
```

The bare `install` command starts an interactive Codex onboarding flow. It
prompts for the LiteLLM gateway, SSO or environment authentication, the Codex
connection mode (`gateway`, `oauth`, or `both`), discovered search tools, MCP
servers, MCP toolsets, and final confirmation. Use `--target both` when the
same flow should configure OpenCode as well. `--non-interactive` is available
only for scripted installs with explicit options.

Auto Router is an optional, TTY-only official LiteLLM wizard for Claude Code;
it does not change Codex or OpenCode routing. Interactive onboarding defaults
to skip, and non-interactive installs also skip unless `--auto-router
configure` is explicit. `--auto-router dry-run` prints the pinned, secret-free
plan without running a subprocess. The opt-in path requires `uv >= 0.10.9` and
runs `litellm[proxy]==1.94.0rc1` in an isolated tool environment.
This upstream PyPI release publishes Linux wheels only. macOS, Windows, and
other non-Linux platforms therefore require a configured `rustc` and `cargo`
for the official sdist build; the wrapper checks both and never installs them.

The wrapper forwards the gateway key only in the official wizard's child
environment, never in argv, output, Keychain, or wrapper-owned files. The
official wizard itself persists that provider key in its mode-`0600`
`~/.litellm/autorouter/config.yaml`. Its `up` command patches Claude settings,
and `down` restores them. After a gateway-key rotation, run the pinned `down`
command, delete that YAML, refresh login/environment authentication, and rerun
`codex-litellm install --auto-router configure`. See the project README for the
exact pinned `uv tool run` commands and source boundary.

GitHub Packages requires authentication for npm reads even when this public
package is readable. The temporary `NPM_CONFIG_USERCONFIG` file keeps the
token out of user-level npm configuration; remove it after use with
`rm -f "$NPM_CONFIG_USERCONFIG"`.

An explicit `--target` is preserved. Other commands and options are forwarded
unchanged to the core package. Node.js
`^22.22.2 || ^24.15.0 || >=26.0.0` is required.

## Installer side effects

Because this wrapper delegates to the core installer, `install` has the same
shared writes as the core package:

- The shared research skill is installed at
  `~/.agents/skills/litellm-research-router/`.
- The nested LiteLLM marketplace entry is merged into
  `~/.claude/settings.json` under `extraKnownMarketplaces.litellm`. Existing
  settings and marketplace entries are preserved; the file is written with
  mode `0600`, and no credential is stored there.
- Depending on the selected target and Codex mode, managed auth/config assets
  include `~/.codex/config.toml`, `~/.codex/litellm-models.json`,
  `~/.codex/litellm-codex-oauth-models.json`,
  `~/.codex/codex-oauth.config.toml`,
  `~/.codex/libexec/litellm-auth-token.mjs`, and
  `$XDG_CONFIG_HOME/opencode-litellm/launch.json` (or
  `~/.config/opencode-litellm/launch.json`). OpenCode-targeted installs also
  update the selected OpenCode config and managed plugin checkout.

The built-in SSO flow stores its local token at `~/.litellm/token.json` with
POSIX mode `0600`; environment authentication uses the configured variable
instead. Config writes use temporary files and atomic rename, and gateway or
OAuth credentials are not written into client configuration files.

See the [project README](https://github.com/happycastle114/opencode-litellm#readme)
for configuration, authentication, and release details.

## License

MIT; see [LICENSE](./LICENSE).
