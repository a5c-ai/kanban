# CLI Manual

This repo ships a small CLI (implemented in `apps/tui`) that can run the SDK operations non-interactively for scripts/CI.

## Install / Build

- Build: `npm run build`
- Run directly: `node apps/tui/dist/index.js --help`

## Quick Start

- Initialize a repo:
  - `node apps/tui/dist/index.js --repo .demo-repo repo init`
- Create a board + list + card:
  - `node apps/tui/dist/index.js --repo .demo-repo board create --name "Project"`
  - `node apps/tui/dist/index.js --repo .demo-repo list create --board-id <boardId> --name "Todo"`
  - `node apps/tui/dist/index.js --repo .demo-repo card create --board-id <boardId> --list-id <listId> --title "First task"`

## Global Flags

- `--repo <path>`: repo to operate on (alternative form: positional `repoPath` before the command)
- `--actor-id <id>`: actor id for ops (default: `$KANBAN_ACTOR_ID` or `cli@local`)
- `--json`: machine-readable output (default: human)
- `--help`, `-h`: help

## Commands

### `workspace`

- `workspace list`: list workspaces
- `workspace show [--workspace-id <id>]`: show workspace details (defaults to the repo’s default workspace)

### `repo`

- `repo init`: create `.kanban/` structure and `format.json` (idempotent)

### `state`

- `state print`: prints current state (human) or `{ state, appliedThroughSeq }` (JSON)
- `state conflicts`: prints conflicts; exits non-zero if conflicts exist

### `board`

- `board list`: list boards (prints `name (boardId)` lines, or JSON `{ boards: [...] }`)
- `board show --board-id <id>`: show lists on a board (use `--include-archived` to count archived cards too)
- `board create --name <name>`: prints `boardId`

### `list`

- `list list --board-id <id>`: list lists in a board (prints `name (listId)` lines, or JSON `{ lists: [...] }`)
- `list show --list-id <id> [--include-archived]`: show cards in a list
- `list create --board-id <id> --name <name>`: prints `listId`
- `list move --list-id <id> --position <n>`: reorders within a board

### `card`

- `card list (--board-id <id> | --list-id <id>) [--include-archived]`: list cards for discovery/scripting
- `card show --card-id <id> [--include-comments]`: show a card’s fields (and optionally comments)
- `card create --board-id <id> --list-id <id> --title <title>`: prints `cardId`
- `card update --card-id <id> [--title <t>] [--description <d>] [--due-date <iso>] [--clear-due-date] [--labels a,b,c]`
- `card move --card-id <id> --to-list-id <id>`
- `card archive --card-id <id>`
- `card unarchive --card-id <id>`
- `card comment add --card-id <id> --text <text>`: prints `commentId`
- `card checklist add --card-id <id> --text <text>`: prints `itemId`
- `card checklist toggle --card-id <id> --item-id <id> --checked true|false`
- `card checklist rename --card-id <id> --item-id <id> --text <text>`
- `card checklist remove --card-id <id> --item-id <id>`

### `member`

- `member list --board-id <id>`
- `member add --board-id <id> --member-id <id> --role viewer|editor`
- `member role --board-id <id> --member-id <id> --role viewer|editor`

### `search`

- `search cards <query>`: searches titles/descriptions/labels of non-archived cards

### `git`

These are thin wrappers around the SDK's `createCliGitAdapter()` (best-effort: if `git` is missing, some commands fail with `git: unavailable`).

- `git status`: exits `1` if dirty, `0` if clean
- `git fetch|pull|push|sync`

## Output & Exit Codes

- Human output is concise and intended for terminals.
- `--json` prints JSON objects to stdout; errors are also JSON.
- Exit codes:
  - `0` success
  - `1` error (including conflicts in `state conflicts`)

## Interactive TUI

If you run with no CLI command (i.e. only `--repo`), the program starts the interactive TUI:

- `node apps/tui/dist/index.js --repo .demo-repo`
