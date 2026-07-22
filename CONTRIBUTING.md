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
- `@happycastle114/codex-litellm` is the thin Codex-focused wrapper around the core CLI. It
  defaults onboarding to Codex while forwarding the shared command surface.

Changes should preserve the managed-file safety, credential boundaries, and
deterministic discovery behavior across OpenCode, Codex, and the Claude launcher.
If a change affects one client only, document that boundary and add coverage for
the affected package or target.

## Development setup

Use Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, npm, and git. `npm ci`
installs the pinned Bun `1.3.14` build/test runtime from `devDependencies`, so
source builds and tests do not rely on a global or unpinned Bun version.

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
npm run test:git-install
npm pack --dry-run --ignore-scripts
(cd packages/codex-litellm && npm pack --dry-run --ignore-scripts)
```

The two pack commands are intentional: every change that can affect the core
CLI must leave both the core package and the Codex wrapper packable. Include the
commands and any relevant client-target scenario in the pull request when a
change touches onboarding, SSO, discovery, skills, or launch environment
handling.

`test:git-install` is a real fixed-SHA consumer test. It runs both `npx`
aliases from empty consumers and separate empty npm caches before the ordinary
install path, then checks the linked bins using the exact toolkit help
signature. CI runs this gate on Ubuntu and Windows; do not replace it with a
substring check or a global Bun installation.

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

The main-branch workflow in
[`.github/workflows/release.yml`](./.github/workflows/release.yml) runs when a
package manifest, wrapper executable, verifier, or the workflow itself changes;
it also supports `workflow_dispatch`. It validates that the core package,
scoped Codex wrapper, and exact wrapper-to-core dependency carry the same
version, runs `npm test`, and packs both artifacts before any registry write.

Publication targets the GitHub Packages npm registry at
`https://npm.pkg.github.com`. The job grants `contents: read` and
`packages: write`, and passes the Actions `GITHUB_TOKEN` as `NODE_AUTH_TOKEN`.
It creates a mode-0600 npm config in `$RUNNER_TEMP` with only the
`@happycastle114` scope mapping and token reference. No Keychain lookup,
`NPM_TOKEN`, or user-level npm config is used.

The workflow preflights each exact version and publishes only packages whose
version is missing. Existing versions must match package name, version,
`gitHead`, GitHub Packages tarball URL, and the SHA-512 integrity of the tested
tarball; an identity mismatch fails instead of republishing an immutable
version. The core tarball is published first, followed by the wrapper. The
readback gate uses `npm view` and `npm pack` against GitHub Packages to verify
metadata, downloaded tarball bytes, embedded package manifests, and the exact
wrapper dependency. A clean consumer then installs the scoped wrapper through
GitHub Packages and runs both shipped binaries.

GitHub Packages requires npm authentication for reads even when a package is
public. For a local consumer, use an ephemeral config and a classic PAT with
`read:packages`:

```sh
export NODE_AUTH_TOKEN='<GitHub classic PAT with read:packages>'
export NPM_CONFIG_USERCONFIG="$(mktemp)"
umask 077
printf '%s\n' \
  '@happycastle114:registry=https://npm.pkg.github.com' \
  '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' \
  'always-auth=true' > "$NPM_CONFIG_USERCONFIG"
npx --yes --package @happycastle114/opencode-litellm@0.6.0 opencode-litellm install
npx --yes --package @happycastle114/codex-litellm@0.6.0 codex-litellm install
rm -f "$NPM_CONFIG_USERCONFIG"
```

The direct full-SHA checkout and locally packed tarball path in the README
remains available when registry access is not desired.

CI and release workflow actions use reviewed, immutable 40-character commit
pins with the corresponding upstream version in an inline comment. When an
action is upgraded, update the commit pin and version comment together from the
official repository tag, then run
`bun test test/workflow-action-pins.test.ts`.

## Code of conduct

Be kind, assume good intent, and keep discussions constructive. We follow the
[Contributor Covenant](https://www.contributor-covenant.org/).
