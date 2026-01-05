# Kanban VS Code extension (local)

Local-first VS Code extension for the git-backed kanban repo format in this monorepo, powered by `@a5c-ai/kanban-sdk`.

## Develop

- Build: `npm run build -w apps/vscode-extension`
- Open this repo in VS Code and run the extension:
  - `Run and Debug` → `Run Extension` (you may want to add a `.vscode/launch.json`)

## Package (local)

- Build + package a VSIX: `npm run package:vsix -w apps/vscode-extension`
- Output: `dist/kanban-vscode-extension-<version>.vsix`

## Verify

- Automated: `npm test`
- Manual: `apps/vscode-extension/VERIFICATION.md`

## Board view message protocol

The Board webview communicates with the extension via `window.postMessage` (see `apps/vscode-extension/src/webview/boardProtocol.ts`).

- Webview → extension: `ready`, `refresh`, `initRepo`, `selectRepo`, `setActiveBoard`, `createBoard`, `renameBoard`, `createList`, `renameList`, `moveList`, `createCard`, `moveCard`, `saveCard`, `addChecklistItem`, `toggleChecklistItem`, `renameChecklistItem`, `removeChecklistItem`, `addComment`, `searchCards`, `getCardHistory`, `openCard`
- Extension → webview: `state`, `searchResults`, `cardHistory`, `opResult`, `toast`
- Request/response: when the webview includes a `requestId`, the extension replies with `opResult { requestId, ok, operation, safeToRetry?, error? }`. The webview uses this to surface errors and offer `Retry` and `Reload latest` affordances.
