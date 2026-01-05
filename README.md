# git-backed agents oriented kanban board

## Setup

```bash
npm install
npm run ci
```

## Run demo

```bash
npm run demo -- --repo ./.demo-repo
```

This creates a new repo at the provided path (with `.kanban/ops/` etc), appends a few ops, rebuilds state, and prints the materialized state JSON.

## Quality gates

- Local: `npm run ci`
- Pre-commit: runs `lint-staged`
- Pre-push: runs `npm test`
- CI: `.github/workflows/ci.yml` runs `npm ci` + `npm run ci`

## Publish (npm)

The repo publishes these workspaces to npmjs (scoped public packages):

- `packages/sdk` → `@a5c-ai/kanban-sdk`
- `apps/demo` → `@a5c-ai/kanban-demo`
- `apps/tui` → `@a5c-ai/kanban-tui`
- `apps/web` → `@a5c-ai/kanban-web`
- `apps/worker` → `@a5c-ai/kanban-worker`

1. Bump package version(s):
   - Bump whichever workspace(s) you want to publish (each must have a new version to publish again), e.g. `npm version patch -w packages/sdk`.
2. Commit the version bump(s) to `main`.
3. Create and push the matching tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

Publishing is performed by `.github/workflows/publish-npm.yml` on tag pushes matching `v*` (and via manual `workflow_dispatch`). It uses the npmjs registry (`https://registry.npmjs.org`) and authenticates only via the `NPM_TOKEN` GitHub secret.
The workflow skips publishing any package if that exact `name@version` is already present on npmjs.

## Release (VS Code extension)

The VS Code extension is released separately (as a VSIX and optionally published to the Marketplace).

1. Bump the extension version in `apps/vscode-extension/package.json`.
2. Commit to `main`.
3. Create and push the matching tag:
   - `git tag vscode-vX.Y.Z`
   - `git push origin vscode-vX.Y.Z`

This triggers `.github/workflows/release-vscode-extension.yml`, which builds/tests, packages `kanban-vscode-extension.vsix`, uploads it to the GitHub Release, and publishes to the VS Code Marketplace if the `VSCE_PAT` secret is set.
