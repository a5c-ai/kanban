# Repo Format (v1)

This document specifies the **on-disk, Git-backed repo format** used by this project. The repo is the database: **`.kanban/ops/` are the source of truth**, and `.kanban/snapshots/` are derived and always rebuildable.

Goals:

- **Deterministic**: replaying the same `.kanban/ops/` yields the same state.
- **Portable**: works across Windows/macOS/Linux; avoid case-sensitive collisions.
- **Merge-friendly**: prefer **append-only** writes; minimize in-place edits.

Non-goals (v1):

- Malicious-write resistance (trust collaborators; Git ACLs provide enforcement).
- Strong identity proofs (op attribution is informational).

## Directory Layout

All paths are **repo-root relative**.

```
.kanban/
  format.json
  integrations/
    webhooks.json
  ops/
    0000000000000001-<opId>.json
    0000000000000002-<opId>.json
  snapshots/
    state.json
    index.json
```

Rules:

- Directory and file names are **lowercase ASCII** where possible.
- JSON files are **UTF-8**, LF newlines are preferred.
- `.kanban/ops/` is append-only. Existing op files MUST NOT be modified in place.

## `.kanban/format.json` (Versioning + Compatibility Marker)

`.kanban/format.json` is the single authoritative marker for the repo format.

Example:

```json
{
  "format": "kanban-git-repo",
  "formatVersion": 1,
  "createdAt": "2026-01-04T18:00:00.000Z",
  "createdBy": {
    "sdk": "@a5c-ai/kanban-sdk",
    "sdkVersion": "0.1.0"
  },
  "defaultWorkspaceId": "uuid"
}
```

Compatibility rules:

- A reader MUST refuse to open repos with an unknown `format` or `formatVersion`.
- Format changes are tracked by incrementing `formatVersion`.
- Migrations (future): add `.kanban/migrations/<n>-to-<n+1>.json` artifacts and keep them rebuildable/derivable when possible.

## Operations (`.kanban/ops/`)

### File naming and ordering

Op files are named:

`.kanban/ops/<seq>-<opId>.json`

Where:

- `<seq>` is a **monotonic, zero-padded decimal** sequence number (16 digits) used for total ordering.
- `<opId>` is a globally unique identifier (UUID/ULID). It is used for idempotency and debugging.

Ordering:

- Rebuilds process ops in ascending lexicographic filename order (equivalent to ascending `<seq>`).
- If two ops share a `<seq>` (possible when multiple replicas create ops offline from the same base), tie-break by `<opId>` lexicographically.

### Op JSON schema (v1)

Each op file is a single JSON object:

```json
{
  "schemaVersion": 1,
  "opId": "0f6b8c7a-07a4-4c30-9a3d-6d18db1d8e9b",
  "seq": 1,
  "type": "board.created",
  "ts": "2026-01-04T18:00:00.000Z",
  "actorId": "alice@laptop",
  "payload": {}
}
```

Field notes:

- `schemaVersion`: op envelope schema version (not the repo format version).
- `ts`: ISO-8601 UTC timestamp.
- `actorId`: human-readable stable identifier configured locally.
- `payload`: type-specific data (see below).

### Event types (v1 SDK foundation)

The initial SDK supports the following op types:

#### `board.created`

Payload:

```json
{
  "workspaceId": "uuid",
  "boardId": "uuid",
  "name": "Board Name"
}
```

#### `list.created`

Payload:

```json
{
  "boardId": "uuid",
  "listId": "uuid",
  "name": "To Do",
  "position": 1000
}
```

#### `list.moved`

Payload:

```json
{
  "listId": "uuid",
  "position": 500
}
```

#### `card.created`

Payload:

```json
{
  "boardId": "uuid",
  "listId": "uuid",
  "cardId": "uuid",
  "title": "Card title",
  "position": 1000
}
```

#### `card.moved`

Payload:

```json
{
  "cardId": "uuid",
  "fromListId": "uuid",
  "toListId": "uuid",
  "position": 2000
}
```

#### `card.updated`

Payload (fields optional; omit to leave unchanged):

```json
{
  "cardId": "uuid",
  "title": "New title",
  "description": "Markdown text",
  "dueDate": "2030-01-02T03:04:05.000Z",
  "labels": ["bug", "p1"]
}
```

Notes:

- `dueDate` may be `null` to clear.

#### `card.archived`

Payload:

```json
{
  "cardId": "uuid",
  "archived": true
}
```

#### `comment.added`

Payload:

```json
{
  "cardId": "uuid",
  "commentId": "uuid",
  "text": "hello"
}
```

#### `checklist.itemAdded`

Payload:

```json
{
  "cardId": "uuid",
  "itemId": "uuid",
  "text": "do it",
  "position": 1000
}
```

#### `checklist.itemToggled`

Payload:

```json
{
  "cardId": "uuid",
  "itemId": "uuid",
  "checked": true
}
```

#### `checklist.itemRenamed`

Payload:

```json
{
  "cardId": "uuid",
  "itemId": "uuid",
  "text": "do it now"
}
```

#### `checklist.itemRemoved`

Payload:

```json
{
  "cardId": "uuid",
  "itemId": "uuid"
}
```

Notes:

- `position` is a numeric ordering key used for deterministic ordering within a list (v1 uses integers; later versions may adopt fractional keys).
- Some event types omit their target `boardId` because it can be derived during replay from current state.

#### `member.added` (board scope)

Payload:

```json
{
  "boardId": "uuid",
  "memberId": "alice@laptop",
  "role": "viewer"
}
```

Notes:

- `memberId` is an `actorId` string (attribution identifier), not a globally validated identity.
- `role` is `"viewer"` or `"editor"` in v1.

#### `member.roleChanged` (board scope)

Payload:

```json
{
  "boardId": "uuid",
  "memberId": "alice@laptop",
  "role": "editor"
}
```

## Integrations (`.kanban/integrations/`)

Integration configs are **optional** and must not be treated as source-of-truth state.

### `.kanban/integrations/webhooks.json`

This file configures outbound webhooks for the `apps/worker` process. It is intentionally JSON (not YAML) to keep v1 dependency-free.

Schema (v1):

```json
{
  "schemaVersion": 1,
  "webhooks": [
    {
      "id": "my-hook",
      "url": "https://example.com/kanban/webhook",
      "events": ["card.created", "card.moved"],
      "headers": {
        "content-language": "en",
        "authorization": { "secretRef": "KANBAN_WEBHOOK_AUTH" }
      },
      "maxAttempts": 5,
      "timeoutMs": 10000
    }
  ]
}
```

Notes:

- `events` is optional; when omitted or empty, the worker delivers all op types.
- `secretRef` resolves to an environment variable; store secrets in env, not in Git.
- The worker sends an idempotency header `X-Webhook-Id: <hookId>:<opId>` and uses best-effort retries with exponential backoff.

## Snapshots and Indexes (`.kanban/snapshots/`)

Snapshots are derived data intended to accelerate reads/search. They are never the source of truth.

### `.kanban/snapshots/state.json`

A materialized state plus a cursor indicating how far it reflects the op log.

Required fields:

- `schemaVersion`: snapshot schema version (v1 = 1)
- `appliedThroughSeq`: the highest op `seq` included in this snapshot
- `state`: the derived domain state (shape is SDK-defined and may evolve)

If `state.json` is missing, stale, or conflicted, it can be deleted and rebuilt from `.kanban/ops/`.

### `.kanban/snapshots/index.json`

Optional metadata for fast open/rebuild decisions (e.g., last rebuild time, counts, last op filename).

## Deterministic Rebuild Guarantees

Given:

- The same set of op files in `.kanban/ops/`, and
- The same replay rules for each `type`,

Then:

- Replaying ops in filename order yields the same derived in-memory state.
- Any snapshots/indexes can be discarded and regenerated to match that state.

## Git Integration (v1)

In v1, Git is treated as a **transport + durability layer**. The SDK defines a thin `GitAdapter` abstraction so clients can:

- Initialize a repo (`git init`)
- Add/commit op files
- Check status and sync with a remote (`git fetch/pull/push`)

Git is optional: if Git is not available on the system, clients can run in “no-git” mode and still read/write the on-disk format.

## Conflict Surfacing (v1 heuristic)

Git-level conflicts are avoided by append-only ops. Semantic conflicts are possible when multiple replicas edit the same field concurrently.

In v1, the SDK surfaces a conflict record when multiple ops share the same `seq` and write different values to the same entity field (e.g., two `card.updated` ops set different `title` values).
