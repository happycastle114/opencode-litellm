# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-04-27

### Added
- **Reasoning-aware transport routing.** Discovered models are now split
  across two providers based on the API surface they require:
  - `litellm` → `/v1/chat/completions` (default, most models)
  - `litellm-responses` → `/v1/responses` (gpt-5*, o1/o3/o4*, or any
    model LiteLLM exposes with `mode === 'responses'`)
  This fixes `BadRequestError: Function tools with reasoning_effort are
  not supported … in /v1/chat/completions` for OpenAI reasoning-tier
  models that need the Responses API when used with tools.
- New `provider.litellm.options.transport` (`"auto"` | `"chat"` |
  `"responses"`, default `"auto"`) global override.
- New `provider.litellm.options.responsesApiModels: string[]` allowlist
  to force specific model ids into the responses bucket.
- New `provider.litellm.options.chatApiModels: string[]` denylist to
  force specific model ids into the chat bucket.
- New `requiresResponsesAPI(model)` exported helper for downstream tools.
- New types: `Transport`, `TransportPolicy`, expanded `LiteLLMOptions`.

### Changed
- The non-destructive merge is now cross-provider: a discovered model is
  skipped if its key already exists under **either** the `litellm` or
  the `litellm-responses` provider, so hand-curated entries win
  regardless of which bucket the heuristic would have picked.
- The `litellm-responses` provider is created lazily — it only appears
  if at least one discovered model needs it (or the user pre-defined it).

### Documentation
- New "Reasoning models (gpt-5, o1/o3/o4)" section in the README.
- New FAQ entries explaining the `reasoning_effort` / Responses API
  error and the dual-provider split.
- Updated mermaid diagram and "How it works" steps to show the bucket
  routing.

## [0.1.1] — 2026-04-27

### Documentation
- Comprehensive README rewrite with hero section, badges (npm version,
  downloads, CI, license, TypeScript strict, PRs welcome), feature
  table, configuration examples, FAQ, compatibility matrix, and a
  Mermaid sequence diagram of the discovery flow.
- Added `CONTRIBUTING.md` covering project philosophy, dev setup,
  local plugin testing via `npm link`, PR checklist, and release process.
- Added `CHANGELOG.md` following the Keep a Changelog 1.1.0 format.
- Added GitHub issue templates (bug report + feature request as YAML
  forms) and a structured pull-request template.
- Added `.github/dependabot.yml` for weekly npm + GitHub Actions updates.

### Fixed
- Removed an accidental self-dependency (`opencode-plugin-litellm`) that
  was added to `package.json` by an earlier `npm link` invocation.

## [0.1.0] — 2026-04-27

### Added
- Initial release of `opencode-litellm`.
- Auto-detection of a running LiteLLM proxy on common ports (`4000`, `8000`, `8080`).
- Dynamic model discovery via the OpenAI-compatible `/v1/models` endpoint.
- Smart name formatting (e.g. `anthropic/claude-3-5-sonnet` → `Claude 3 5 Sonnet`,
  `qwen/qwen3-30b-a3b` → `Qwen3 30B A3B`, with brand-aware handling for `gpt-4o`).
- Modality categorization — chat / embedding / image / audio inferred from
  the LiteLLM `mode` field or the model id.
- Provider extraction — uses `litellm_provider` (or the `provider/model` prefix)
  to populate `organizationOwner`.
- API key support via `LITELLM_API_KEY` / `LITELLM_MASTER_KEY` env vars or
  `provider.litellm.options.apiKey`.
- Non-destructive merge — hand-curated entries under `provider.litellm.models`
  are preserved.
- 5-second discovery timeout so a slow / offline proxy never blocks OpenCode startup.
- GitHub Actions CI workflow (typecheck on Node 20 & 22).
- Auto-publish workflow on GitHub release (requires `NPM_TOKEN` secret).

[Unreleased]: https://github.com/yuseferi/opencode-litellm/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yuseferi/opencode-litellm/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/yuseferi/opencode-litellm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yuseferi/opencode-litellm/releases/tag/v0.1.0
