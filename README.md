# opencode-litellm

[![npm version](https://img.shields.io/npm/v/opencode-plugin-litellm.svg)](https://www.npmjs.com/package/opencode-plugin-litellm)
[![CI](https://github.com/yuseferi/opencode-litellm/actions/workflows/ci.yml/badge.svg)](https://github.com/yuseferi/opencode-litellm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

OpenCode plugin for [LiteLLM](https://github.com/BerriAI/litellm) proxy support
with **auto-detection** and **dynamic model discovery**.

Inspired by [`opencode-lmstudio`](https://github.com/agustif/opencode-lmstudio).

> **npm package name:** `opencode-plugin-litellm` (the unscoped `opencode-litellm`
> name was taken on npm). Repo name and plugin export remain `opencode-litellm`.

## Features

- **Auto-detection** — finds a LiteLLM proxy running on common ports (`4000`, `8000`, `8080`)
- **Dynamic model discovery** — queries `/v1/models` so you never hand-maintain a model list
- **OpenAI-compatible** — registers under OpenCode as `@ai-sdk/openai-compatible`
- **Vendor-aware** — extracts `litellm_provider` (or the `provider/model` prefix) into `organizationOwner`
- **Smart formatting** — turns `anthropic/claude-3-5-sonnet` into `Claude 3 5 Sonnet` in the picker
- **Categorization** — chat / embedding / image / audio modalities are inferred from the model `mode` or id
- **Non-blocking** — discovery is capped at 5s so a slow proxy never blocks OpenCode startup

## Installation

```bash
npm install opencode-plugin-litellm
# or
bun add opencode-plugin-litellm
```

## Usage

### Zero-config (recommended)

If a LiteLLM proxy is already running on `localhost:4000`, just add the plugin:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-litellm@latest"]
}
```

The plugin will detect the proxy, query `/v1/models`, and inject every model into
your provider list automatically.

### Manual configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-litellm@latest"],
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteLLM (proxy)",
      "options": {
        "baseURL": "http://localhost:4000/v1",
        "apiKey": "{env:LITELLM_API_KEY}"
      }
    }
  }
}
```

Any models you predefine under `provider.litellm.models` are kept as-is; the
plugin only adds models it discovers that aren't already configured.

### Authentication

If your LiteLLM proxy requires a master key, expose it via either:

- `apiKey` field inside `provider.litellm.options`, or
- the `LITELLM_API_KEY` (or `LITELLM_MASTER_KEY`) environment variable.

## How it works

1. On OpenCode startup the `config` hook fires.
2. If a `litellm` provider is configured, its `baseURL` is used. Otherwise the
   plugin probes `localhost:4000`, `:8000`, `:8080`.
3. Health check via `GET /v1/models`. If unreachable, the hook is a no-op.
4. Models from `/v1/models` are turned into OpenCode model entries with
   sensible `name`, `organizationOwner`, and `modalities` fields.
5. Discovered models are merged on top of any user-configured ones.

## Requirements

- OpenCode with plugin support (`@opencode-ai/plugin ^1.0.166`)
- A running LiteLLM proxy (`pip install 'litellm[proxy]' && litellm --config config.yaml`)

## License

MIT
