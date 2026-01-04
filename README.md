# trello-clone (git-backed kanban)

Minimal npm-workspaces monorepo with a small TypeScript SDK and a Node demo CLI.

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
