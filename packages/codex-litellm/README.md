# @happycastle/codex-litellm

Thin Codex-focused wrapper for
[`@happycastle/opencode-litellm`](https://github.com/happycastle114/opencode-litellm).
Defaults `install` to `--target codex`; everything else is forwarded to the
core CLI.

## 환경별 설치 안내

- [Windows](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.windows.md)
- [macOS](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.macos.md)
- [Linux / WSL](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.linux.md)
- [로그인·모델 갱신·문제 해결](https://github.com/happycastle114/opencode-litellm/blob/main/docs/client-setup.md)

## Quick start

```bash
uv tool install 'litellm[cli]==1.101.0'
lite --version

# Install for Codex (interactive)
npx @happycastle/codex-litellm install

# Install for both Codex and OpenCode
npx @happycastle/codex-litellm install --target both

# Launch Codex with the installed config
npx @happycastle/codex-litellm codex
```

## What it does

- Prompts for LiteLLM gateway URL, auth (SSO or env key), and Codex mode
  (`gateway`, `oauth`, or `both`)
- Discovers models, search tools, MCP servers, and toolsets
- Writes a `/model`-compatible Codex catalog and enables native live web search
- Refreshes gateway models and native per-model fields before each CLI launch;
  failed refresh stops the launch instead of using a stale catalog
- Installs the shared research skill at `~/.agents/skills/litellm-research-router/`

SSO uses the official `lite login --pkce`, `lite auth print-token`, and
`lite logout` commands with the configured gateway URL. The official CLI owns
renewal and OS keyring storage; `~/.litellm/token.json` holds metadata, with
owner-only file storage when no usable keyring exists. Python is required by
the CLI and can be managed by [uv](https://docs.astral.sh/uv/guides/tools/).

Manual keys use `--auth env` and the separate owner-only file
`~/.config/opencode-litellm/api-key.json` (`XDG_CONFIG_HOME` is honored).
Keys saved by older toolkit versions require interactive re-entry; the toolkit
does not infer or import manual keys from the official SSO store.
Codex SSO invokes `lite --base-url <origin> auth print-token` directly through
native command auth. Only saved manual keys need the toolkit's file reader.

For OAuth pass-through in `both` mode, run
`npx @happycastle/codex-litellm codex --profile codex-oauth`. The launcher supplies
OAuth/MCP gateway admission keys only to the child process; it never exports
them with `launchctl`. Opening the desktop app icon does not run this launcher
or refresh the gateway model list. See the
[setup guide](https://github.com/happycastle114/opencode-litellm/blob/main/docs/client-setup.md).

## Requirements

- Node.js `^22.22.2 || ^24.12.0 || >=26.0.0`
- Codex installed; the 0.8.0 release target is CLI `0.154.0`
- Official LiteLLM CLI `1.101.0` on PATH for SSO
- A reachable LiteLLM gateway

## License

MIT — see [LICENSE](./LICENSE).
