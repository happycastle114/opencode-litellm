# Contributing to opencode-litellm

Thanks for helping improve the LiteLLM client toolkit maintained in the
[`happycastle114/opencode-litellm`](https://github.com/happycastle114/opencode-litellm)
repository. Keep changes focused, typed, and easy to verify on the real client
surfaces.

## Project scope

This repository contains a two-package toolkit, not only an OpenCode model
plugin:

- `@happycastle114/opencode-litellm` is the core plugin and CLI. It configures
  OpenCode and Codex, discovers LiteLLM models/search tools/MCP servers/toolsets,
  runs the documented LiteLLM SSO flow, manages the shared research skill, and
  launches OpenCode, Codex, or Claude Code with child-scoped credentials.
- `codex-litellm` is the thin Codex-focused wrapper around the core CLI. It
  defaults onboarding to Codex while forwarding the shared command surface.

Changes should preserve the managed-file safety, credential boundaries, and
deterministic discovery behavior across OpenCode, Codex, and the Claude launcher.
If a change affects one client only, document that boundary and add coverage for
the affected package or target.

## Development setup

Use Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, npm, and git. Source builds and
tests also require Bun
`1.3.14`, the pinned version used by CI and the release workflow. Do not rely on
an unpinned Bun version for a passing report.

```bash
git clone https://github.com/happycastle114/opencode-litellm.git
cd opencode-litellm
npm ci
```

Keep gateway keys, SSO tokens, OAuth credentials, and local client config out of
the repository. Use a disposable home/config directory for onboarding or
launcher checks when possible.

## Validation gates

Run the same gates as CI from the repository root:

```bash
npm ci
npm test                         # builds, then runs the Bun test suite
npm run build
npm run typecheck
npm pack --dry-run --ignore-scripts
(cd packages/codex-litellm && npm pack --dry-run --ignore-scripts)
```

The two pack commands are intentional: every change that can affect the core
CLI must leave both the core package and the Codex wrapper packable. Include the
commands and any relevant client-target scenario in the pull request when a
change touches onboarding, SSO, discovery, skills, or launch environment
handling.

## Pull requests

- Explain the user-visible behavior and identify the target (`OpenCode`,
  `Codex`, `Claude`, or shared toolkit/package behavior).
- Add or update focused tests for changed behavior and update the README or
  other source documentation when a command, flag, endpoint, or managed file
  changes.
- Keep dependency changes deliberate. Runtime OpenCode dependencies are pinned
  to the versions tested by the lockfile; update them together with a fresh
  `npm ci` validation when the tested version changes.
- Do not include secrets, real gateway responses containing credentials, or
  machine-specific client configuration in commits.

Use the repository's issue forms for reproducible bug reports and feature
requests. Include the package target, toolkit version, client versions, runtime
versions, operating system, and sanitized logs where applicable.

## Maintainer release workflow

The tagged-release workflow in
[`.github/workflows/release.yml`](./.github/workflows/release.yml) validates that
the tag, core package, Codex wrapper, and wrapper-to-core dependency all carry
the same version. It runs the repository's `npm test` build/typecheck/test gate
and then packs and installs both exact tarballs before any registry operation.

Registry publication is configured for npm Trusted Publishing with GitHub
Actions OIDC (`id-token: write`) and provenance. It does not read an
`NPM_TOKEN` repository secret. The workflow handles the core
`@happycastle114/opencode-litellm` package and the `codex-litellm` wrapper as
separate package artifacts, with registry/git-head checks to avoid reprocessing
an already-associated tag. The preflight also compares each registry record's
published `dist.integrity` with the exact tarball that is about to be published.

### One-time bootstrap for empty npm records

The public records for both packages are currently absent (npm returns E404),
so the workflow intentionally stops with `Bootstrap required` before it can
consume the final `0.6.0` version. npm versions are immutable after publication;
do not publish `0.6.0` as a bootstrap and do not repoint the `latest` dist-tag.
See npm's [publish documentation](https://docs.npmjs.com/cli/publish/) and
[unpublish policy](https://docs.npmjs.com/policies/unpublish/) before starting.

Use a temporary checkout or staging directories so the release checkout is
restored to the final manifests afterward:

1. Set both package versions to `0.6.0-bootstrap.0` and temporarily set the
   wrapper's exact core dependency to `0.6.0-bootstrap.0`. Build and pack the
   core tarball first, then the wrapper tarball.
2. Publish the core tarball first, followed by the wrapper, using a non-latest
   tag:

   ```sh
   npm publish ./opencode-litellm-0.6.0-bootstrap.0.tgz --tag bootstrap --access public
   npm publish ./codex-litellm-0.6.0-bootstrap.0.tgz --tag bootstrap --access public
   ```

3. Configure GitHub Trusted Publishers for each package from the repository
   root. Run the exact commands below (once per package):

   ```sh
   npm trust github '@happycastle114/opencode-litellm' --file release.yml --repo happycastle114/opencode-litellm --allow-publish
   npm trust github 'codex-litellm' --file release.yml --repo happycastle114/opencode-litellm --allow-publish
   ```

   These commands must identify the `release.yml` workflow in the
   `happycastle114/opencode-litellm` repository. Review npm's
   [Trusted Publishers guide](https://docs.npmjs.com/trusted-publishers/) and
   [`npm trust` reference](https://docs.npmjs.com/cli/v12/commands/npm-trust/)
   if the package owner or workflow path differs.
4. Restore the final manifests to core `0.6.0`, wrapper `0.6.0`, and the exact
   wrapper dependency `@happycastle114/opencode-litellm: 0.6.0`. Verify the
   temporary bootstrap version is absent, run the normal tests, and only then
   push the exact `v0.6.0` tag. The workflow trigger is deliberately limited to
   that tag; it does not accept a generic `v*` tag.

After the bootstrap and trust configuration, the `v0.6.0` run will find the
existing package records, publish only missing exact tarballs, verify npm
metadata and provenance, perform a clean consumer install, and create the GitHub
release only when all checks succeed. npm's
[provenance verification guidance](https://docs.npmjs.com/viewing-package-provenance/)
describes the registry-side attestation that the readback gate checks.

CI and release workflow actions use reviewed, immutable 40-character commit
pins with the corresponding upstream version in an inline comment. When an
action is upgraded, update the commit pin and version comment together from the
official repository tag, then run
`bun test test/workflow-action-pins.test.ts`.

## Code of conduct

Be kind, assume good intent, and keep discussions constructive. We follow the
[Contributor Covenant](https://www.contributor-covenant.org/).
