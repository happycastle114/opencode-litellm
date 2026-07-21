# codex-litellm

`codex-litellm` is the thin Codex-focused wrapper for
[`@happycastle114/opencode-litellm`](https://github.com/happycastle114/opencode-litellm).
It forwards commands to the core CLI and makes `install` target Codex by
default.

## Usage

```bash
npx codex-litellm install
npx codex-litellm install --target both
npx codex-litellm whoami
```

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
