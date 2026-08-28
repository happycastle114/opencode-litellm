# Windows setup

Use Windows 11 when possible. Codex supports a native PowerShell sandbox on
Windows, while WSL remains useful for Linux-native workflows. Install a supported
Node.js version (`22.22.2`, `24.12.0` or newer in the 24.x line, or `26+`) and
install OpenCode and/or Codex before running this setup.

## Interactive setup

From a clone of this repository, run in Command Prompt or PowerShell:

```powershell
.\scripts\setup-windows.bat
```

The batch file checks `node` and `npx`, then starts the published installer for
both clients. It does not forward arbitrary arguments or read macOS Keychain.
The installer prompts for the LiteLLM gateway URL, authentication method, model,
web search, and MCP choices.

You can run the same installer without cloning the repository:

```powershell
npx --yes @happycastle/opencode-litellm@latest install --target both
```

## Non-interactive environment-key setup

Keep the key in the current PowerShell process and remove it after installation:

```powershell
$env:LITELLM_BASE_URL = 'https://litellm.example.com'
$env:LITELLM_PROXY_API_KEY = 'replace-me'
npx --yes @happycastle/opencode-litellm@latest install --target both --auth env --codex-mode gateway --non-interactive
Remove-Item Env:LITELLM_PROXY_API_KEY
```

The generated client configuration refers to the environment variable instead
of embedding its value. SSO tokens, when selected, use the normal LiteLLM token
file under the current Windows user profile.

## Verify

Run the managed doctor and each client's model listing:

```powershell
npx --yes @happycastle/opencode-litellm@latest doctor --target both --json
# Equivalent after a global install: opencode-litellm doctor --target both --json
opencode models litellm
codex debug models --bundled
```

The model picker is populated from the authenticated gateway `/v1/models`
response. LiteLLM 1.98.0 also exposes callable routing groups there, so permitted
routing groups can appear alongside concrete models. The public LiteLLM Model
Catalog is reference metadata only; it is not used as the gateway access list.

## Optional LiteLLM Auto Router

Install `uv`, then rerun the installer with `--auto-router configure`. The
toolkit pins `litellm[proxy]==1.98.0`. That release publishes a Windows wheel, so
a Rust compiler is not required for this path.

## Official references

- [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [LiteLLM proxy CLI](https://docs.litellm.ai/docs/proxy/cli)
- [LiteLLM v1.98.0](https://github.com/BerriAI/litellm/releases/tag/v1.98.0)
