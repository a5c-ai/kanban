# Distributed Kanban (Trello-like) Clone - Git-Backed

This project is a minimal, sleek Kanban board clone that is **distributed and decentralized**: the **Git repository is the database and source of truth**, and each user works from a local clone. There is **no central authoritative application backend**; core behavior lives in a shared **SDK** used by the Web UI and TUI/CLI. The only always-on server component is an optional **webhook reactor/worker** that watches repos and delivers outbound webhook events.

## Purpose & Audience

This document is the project-level overview for:

- Contributors implementing SDK, clients, or the worker.
- Reviewers aligning on scope, boundaries, and how the system works end-to-end.

After reading, you should be able to answer: what we are building in v1, what we are not building, how data is stored/synced/merged, and where webhooks and configuration fit.

Deliverable: this document defines the v1 scope and system boundaries and is the basis for design review and implementation alignment.

## Assumptions (Identity & Collaboration)

- **Actor identity**: every commit/op is attributed to an `actorId` (stable, human-readable identifier) configured locally (e.g., `user@laptop` or `alice@example.com`). In v1 this is **attribution**, not proof of identity.
- **Sharing model**: collaboration happens by sharing a Git remote (or passing bundles) to exchange commits. Anyone with read access to the remote can read all workspace content and history.
- **Trust model**: collaborators with write access are trusted not to intentionally corrupt data; the system is designed to be resilient to accidental conflicts, not malicious writes.
- **What "auth" means in v1**: authentication/authorization is provided by the Git transport/hosting layer (SSH keys, HTTPS tokens, repo ACLs). The app does not add a centralized login service; in-repo "membership" is used for UX and future policy, not strong enforcement.

## What's In / Out of Scope (v1)

### In scope (MVP)

- **Web client**: responsive Kanban UI (Workspaces -> Boards -> Lists -> Cards) with drag/drop ordering.
- **TUI/CLI client**: core offline workflows (browse boards, open board, move cards, edit card title/description, sync status).
- **SDK-first domain layer**: all mutations and queries go through a shared SDK API; UIs are thin shells.
- **Git-backed storage model**: deterministic repo layout and deterministic commits for every user operation.
- **Offline-first**: create/edit/move/archive while disconnected; sync later without losing locally-created objects.
- **Deterministic conflict handling**: repeatable merge policy; conflicts surfaced to users (log/view) with entity ids + fields.
- **Search** across cards (at least title/description/labels) using local indexes.
- **Audit/history** view per card (derived from Git history / ops).
- **Core card fields**: title, description (basic Markdown), labels, due date, and checklists.
- **Card comments (basic)**: simple comment entries as part of activity/audit history (no advanced formatting, mentions, or reactions).
- **Membership (basic)**: board-level membership for UX (e.g., "who can edit"), with enforcement primarily via Git remote permissions.
- **Webhook reactor** (optional deployment): derives domain events from Git changes and delivers outbound webhooks with retries.

### Out of scope (v1)

- Native mobile apps and native desktop apps.
- A centralized datastore or "primary" server database.
- Advanced realtime collaboration (presence/typing, multi-cursor). Correctness comes from Git sync.
- Binary attachment syncing (and any Git history rewrites to manage large binaries).
- Attachment previews, thumbnails, and any rich media pipeline.
- Rich editor features beyond basic Markdown (e.g., Mermaid/embeds/advanced extensions).
- Enterprise auth/SSO and advanced authorization (field-level policies, org-wide controls).
- Push notifications, automation rules engine beyond webhooks, integrations marketplace.
- Fine-grained permissions/roles (admins, observers, per-list/card ACLs) beyond basic membership.
- Power-ups/custom fields, advanced card metadata, and analytics dashboards.

#### Trello Feature Boundaries (v1)

This project is "Trello-like" in interaction model, but intentionally not a full Trello clone in v1:

- **Included**: boards/lists/cards, ordering + drag/drop, labels, due dates, checklists, basic comments, archive/restore, search, and per-card history.
- **Deferred**: attachments, notifications (email/push), rich comments/mentions, advanced permissions/roles, automation beyond webhooks, and power-ups/custom fields.

## End-to-End User Workflow (MVP)

- Initialize or clone a workspace repo; open it in Web or TUI.
- Create workspace/board/list/card; edit card fields (title/description/labels/due/checklist); archive/restore.
- Drag/drop to reorder cards within a list and move cards between lists.
- Search across cards; open a card and view its history timeline.
- Sync: fetch/pull remote changes, merge deterministically, and push local commits when online.
- If concurrent edits occur, see a conflict entry (and resolution guidance) instead of silent data loss.

## How This Works

### Repo-as-database

All state is represented as files in a Git repository. Sync is exchanging commits with a remote using standard Git transport semantics (`fetch/pull/push`). Cloning the repo reconstructs the workspace state.

At a high level, the repo contains:

- `ops/`: append-only operation/event records (source of truth).
- `snapshots/` (or similar): derived/materialized views for fast startup and search (rebuildable).
- `meta/`: repo format version and compatibility markers.
- `config/` (or `.kanban/`): integration and automation configuration (e.g., webhooks).

The precise layout is documented by the repo format spec; the key invariant is that the layout is deterministic and portable.

Repo format specification: `docs/repo-format.md`

### Operations and snapshots

- **Operations ("ops")** are immutable records describing a user intent (e.g., `card.moved`, `card.updated`). They are written as new files to avoid in-place edits that cause frequent merge conflicts.
- **Snapshots** are derived from ops (fold/replay) to accelerate reads and search. If a snapshot conflicts, it can be discarded and rebuilt from ops.

### Write path (SDK mutation -> commit)

1. A user action calls an SDK mutation (e.g., "move card").
2. The SDK validates, writes one or more op files, updates any derived views/indexes, and creates a Git commit with machine-readable metadata (actor id, op type, client id, timestamp).
3. If online and configured, the SDK pushes the commit.

### Read path (repo -> UI)

1. The client opens a local clone.
2. The SDK loads snapshots/indexes if available and replays any missing ops.
3. The UI queries the SDK and subscribes to an SDK event stream for updates.

### Sync loop (distributed Git)

The SDK owns sync behavior:

- Fetch/pull remote updates and integrate them locally (merge/rebase policy is deterministic).
- Rebuild/refresh derived views as needed.
- Push local commits when possible.

Correctness depends on Git history convergence; realtime (when present) is an optimization (e.g., broadcasting "new commit observed" to reduce polling), not an alternate source of truth.

### Conflict handling (deterministic)

Conflicts can be:

- **Git-level conflicts** (same file edited differently). The ops-first design aims to avoid this by writing new files for most mutations.
- **Semantic conflicts** (two users change the same entity concurrently). The SDK resolves via repeatable rules (e.g., field-level last-writer-wins with deterministic tie-breakers) and emits explicit conflict records when user attention is required.

The key requirement: given the same set of commits/ops, every replica produces the same materialized state and the same "conflict surfaced" results.

## Components & Boundaries

- **SDK (source of truth)**: repo format IO, validation, deterministic commits, sync engine, query APIs, indexes, and an event stream.
- **Web client (Next.js)**: Kanban UI + drag/drop + search + history; calls only the SDK for domain operations.
- **TUI/CLI (Ink)**: keyboard-first workflows and sync visibility; calls only the SDK.
- **Webhook reactor/worker (Node.js)**: watches repos for new changes, derives domain events, and delivers webhooks; uses the SDK in headless mode to interpret Git state consistently.

## Platform & Deployment Assumptions (v1)

- **Local-first apps**: the Web client and TUI/CLI operate on a local clone on disk; they do not require any always-on backend to function.
- **No hosted "app server"**: there is no central service that owns workspace state; collaboration is Git remote-based.
- **Optional self-hosted worker**: the webhook reactor runs separately, has filesystem access to a clone (or bare repo), and receives secrets at runtime (env/secret manager), not from Git.

## Dependencies / Constraints

- **Git required**: v1 assumes Git is installed and available on `PATH` (recommended Git >= 2.30). Git is the sync/transport layer; if Git cannot fetch/pull/push, the app cannot sync.
- **Node.js tooling**: the Web client, TUI/CLI, SDK, and worker are Node.js-based (target Node.js LTS; exact minimum version is a release constraint).
- **Package manager**: v1 assumes a standard JS package manager (pnpm/npm/yarn); lockfile choice is a repo decision.
- **OS targets**: Windows/macOS/Linux are supported as long as Git and Node.js are available; files are stored in a cross-platform, case-safe, line-ending-stable format.
- **Explicitly out of scope**: Git LFS is not required or supported in v1; binary attachment workflows are deferred.

## Webhook Reactor & Config-in-Repo

The webhook reactor is an optional, self-hostable worker that:

- Tracks a repo (clone/fetch) and identifies newly-seen commits/ops.
- Maps changes to domain events (e.g., `card.moved`, `card.updated`).
- Evaluates an **in-repo** webhook subscription config (versioned alongside the workspace).
- Delivers outbound HTTPS webhooks with **at-least-once** semantics, retries/backoff, and idempotency keys (e.g., op id / commit sha).

Configuration lives in the repo (suggested): `.kanban/integrations/webhooks.yaml` (subscriptions). Secrets do **not** live in Git; configs reference secrets by name (e.g., `secretRef`) and the worker injects them at runtime (env/secret manager).

## Data Model (Conceptual)

Core objects are Trello-like:

- Workspace -> Boards -> Lists -> Cards
- Labels, due dates, checklist + checklist items, basic comments, membership (read/write roles), and activity/audit events

IDs are globally unique (UUID/ULID) and generated client-side to support offline creation.

## Security / Privacy (MVP)

- **Threat model (summary)**:
  - **Accidental conflicts**: concurrent edits and merges are expected; the SDK must detect and surface conflicts deterministically to avoid silent data loss.
  - **Malicious collaborator**: anyone with write access to the shared remote can introduce arbitrary commits/ops; v1 does not attempt to fully defend against this (trust is primarily social + remote ACLs).
  - **Compromised remote**: hosting providers may be able to read repo contents unless additional encryption is used (deferred in v1).
- **What is stored in-repo**: all workspace content (boards/lists/cards, descriptions, comments, history, config) and derived snapshots/indexes (rebuildable). Treat the repo as sensitive data.
- **What is not stored in-repo**: webhook secrets/credentials and other runtime secrets (only secret references such as `secretRef` live in Git).
- **Signing/encryption stance**: commit/op signing and end-to-end encryption are deferred in v1; they are candidates for later hardening (e.g., optional signed commits, encrypted remotes, or encrypted payload fields).

## Non-Functional Expectations (MVP)

- **Portability**: `git clone` + open should reconstruct the same workspace state.
- **Determinism**: stable file layout + stable commit metadata; same inputs produce same outputs.
- **Performance**: typical boards load fast and remain responsive during frequent edits (smooth drag/drop).
- **Scale targets (v1)**: target smooth UX at ~10 lists / ~1,000 cards / ~5,000 ops on a typical laptop; search results should feel near-instant (sub-second).
- **Reliability**: ops are append-only and commits are the unit of durability; derived snapshots/indexes must always be rebuildable from ops.
- **Privacy**: no unexpected telemetry; avoid storing secrets in repo; use HTTPS for webhooks.

## Glossary

- **Repo**: the Git repository holding workspace state (the "database").
- **Operation (op)**: an append-only change record (event) stored as a file.
- **Snapshot**: derived/materialized state rebuilt from ops for fast reads/search.
- **Sync**: exchanging commits with a remote (fetch/pull/push) and integrating history locally.
- **Deterministic merge**: merge/conflict rules that always yield the same result for the same inputs.
- **Reactor/worker**: server-side process that observes repo changes and delivers webhooks.

## Open Questions / Risks (Tracked)

These are tracked as lightweight RFCs (or equivalent design notes) with an explicit owner and decision milestone before a release cut.

- Finalize the canonical conflict policy (event-log fold rules vs state-merge rules) and the ordering strategy for lists/cards. Decision: RFC (Owner: TBD, Milestone: v1 beta).
- Clarify identity/trust model: what constitutes an `actorId`, and whether commit/op signing is required in v1. Decision: RFC (Owner: TBD, Milestone: v1 beta).
- Decide minimal transport assumptions for sync (pure Git remotes first; optional realtime notifications later). Decision: RFC (Owner: TBD, Milestone: v1 beta).

## Acceptance Checklist

- `docs/overview.md` clearly states purpose, audience, and v1 scope boundaries (including "mobile out of scope").
- Includes a coherent "How This Works" section covering repo-as-db, ops + snapshots, sync loop, and conflict handling.
- Mentions SDK-first boundaries and keeps "server" limited to the webhook reactor/worker role.
- Includes a short section on webhook reactor and config-in-repo (and explicitly excludes storing secrets in Git).
- Includes a short glossary and an explicit in/out-of-scope list.
- Contains measurable-ish expectations (offline-first, determinism, portability) without contradicting scope.
