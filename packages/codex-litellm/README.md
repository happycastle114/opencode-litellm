# @happycastle/codex-litellm

Connect Codex to your own LiteLLM gateway and optionally combine your ChatGPT
subscription with paid gateway models. This is an installer and launcher for
[`@happycastle/opencode-litellm`](https://github.com/happycastle114/opencode-litellm).
Defaults `install` to `--target codex`; everything else is forwarded to the
core CLI.

## 환경별 설치 안내

- [Windows](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.windows.md)
- [macOS](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.macos.md)
- [Linux / WSL](https://github.com/happycastle114/opencode-litellm/blob/main/docs/README.linux.md)
- [로그인·모델 갱신·문제 해결](https://github.com/happycastle114/opencode-litellm/blob/main/docs/client-setup.md)

## Quick start

Install Node.js and Codex first (versions below). Get your gateway URL and an
API key from its administrator. No Happycastle account or server is required.

```bash
# Enter the URL and API key in the interactive prompts
npx @happycastle/codex-litellm install --auth env --codex-mode gateway

# Launch Codex with the installed config
npx @happycastle/codex-litellm codex
```

The API key option does not require Python or the `lite` CLI. In Codex, use
`/model` to choose a model your gateway allows.

For **subscription first, then paid LiteLLM fallback**, run the installer with
`--auth env --codex-mode hybrid-client`. Choose the paid fallback model in the
wizard and confirm the plan. Launch with the same command above and sign in
to ChatGPT when Codex asks; this is separate from your gateway login.

| Choice | When to use it |
|---|---|
| `gateway` | LiteLLM models only; standard gateway |
| `hybrid-client` | Subscription + LiteLLM in one picker; standard gateway, launcher required |
| `hybrid-server` | Same picker; your administrator has installed the `/codex-hybrid` server extension |
| `oauth` / `both` | Subscription proxy / separate profiles; requires the `/codex-oauth` server extension. `both` switches manually |

Hybrid starts on **Auto**, which can incur gateway charges after confirmed
subscription quota exhaustion before output. **Subscription** never falls back;
**LiteLLM** uses the gateway directly. The chosen paid model is saved in the
install plan. Re-run install to change it. Client mode must stay open through
the launcher; starting the desktop app icon does not start its local proxy.

For gateway browser login instead of an API key, install the official CLI:

```bash
uv tool install 'litellm[cli]==1.101.0'
npx @happycastle/codex-litellm install --auth sso --codex-mode gateway
```

SSO requires a gateway that supports the official LiteLLM login flow. To also
configure OpenCode, add `--target both`.

## Relationship to official `lite codex`

This toolkit follows the same custom-provider, `/v1/models`, and HTTP/SSE
Responses API approach as official
[`lite codex`](https://docs.litellm.ai/docs/proxy/management_cli).
It launches Codex itself; it does not wrap the `lite codex` command. SSO does
call official `lite` authentication commands. The shared model picker,
subscription fallback, MCP setup, and file-only authentication policy are
toolkit features; stock LiteLLM does not supply the hybrid server extension.

## What it does

- Prompts for LiteLLM gateway URL, auth (SSO or env key), and Codex mode
  (`gateway`, `oauth`, `both`, `hybrid-server`, or `hybrid-client`)
- Discovers models, search tools, MCP servers, and toolsets
- Writes a `/model`-compatible Codex catalog and enables native live web search
- Refreshes gateway models and native per-model fields before each CLI launch;
  failed refresh stops the launch instead of using a stale catalog
- Installs the shared research skill at `~/.agents/skills/litellm-research-router/`

SSO uses the official `lite login --pkce`, `lite auth print-token`, and
`lite logout` commands with the configured gateway URL. The official CLI owns
renewal and owner-only storage in `~/.litellm/token.json`. The toolkit forces
`LITELLM_CLI_DISABLE_KEYRING=1` and selects file storage for Codex login and MCP
OAuth credentials. Python is required by
the CLI and can be managed by [uv](https://docs.astral.sh/uv/guides/tools/).

Manual keys use `--auth env` and the separate owner-only file
`~/.config/opencode-litellm/api-key.json` (`XDG_CONFIG_HOME` is honored).
Keys saved by older toolkit versions require interactive re-entry; the toolkit
does not infer or import manual keys from the official SSO store.
Codex SSO uses a private helper that invokes `lite --base-url <origin> auth print-token`
with keyring access disabled, including direct desktop launches. Saved manual
keys use an exact-file reader. Reinstall older configurations to replace direct
`lite` auth commands; keychain-only logins require a new toolkit `login`.
Existing OS keychain entries are never read, migrated, or deleted.

For OAuth pass-through in `both` mode, run
`npx @happycastle/codex-litellm codex --profile codex-oauth`. The launcher supplies
OAuth/MCP gateway admission keys only to the child process; it never exports
them with `launchctl`. Opening the desktop app icon does not run this launcher
or refresh the gateway model list. See the
[setup guide](https://github.com/happycastle114/opencode-litellm/blob/main/docs/client-setup.md).

## Requirements

Non-interactive hybrid installation requires
`--codex-fallback-model <authorized-chat-model>` explicitly. A standard gateway
must support `/v1/models` and `/v1/responses`; search and MCP endpoints are
optional. See the core
[hybrid setup and limits](https://github.com/happycastle114/opencode-litellm#codex).

- Node.js `^22.22.2 || ^24.12.0 || >=26.0.0`
- Codex installed; the 0.8.0 release target is CLI `0.154.0`
- Official LiteLLM CLI `1.101.0` on PATH for SSO
- A reachable LiteLLM gateway

## License

MIT — see [LICENSE](./LICENSE).
