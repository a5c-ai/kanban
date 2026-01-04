import fs from "node:fs/promises";
import fsWatch from "node:fs";
import path from "node:path";
import {
  newId,
  type ActorId,
  type BoardId,
  type CardId,
  type ChecklistItemId,
  type CommentId,
  type ListId,
  type OpId,
  type WorkspaceId,
} from "./ids";
import type { GitAdapter } from "./git";
import type { MemberRole } from "./model";
import { getOpsDir, readRepoFormat } from "./repo";

export type OpType =
  | "board.created"
  | "list.created"
  | "list.moved"
  | "card.created"
  | "card.moved"
  | "card.updated"
  | "card.archived"
  | "comment.added"
  | "checklist.itemAdded"
  | "checklist.itemToggled"
  | "checklist.itemRenamed"
  | "checklist.itemRemoved"
  | "member.added"
  | "member.roleChanged";

export interface OpEnvelope<TType extends OpType, TPayload> {
  schemaVersion: 1;
  opId: OpId;
  seq: number;
  type: TType;
  ts: string;
  actorId: ActorId;
  payload: TPayload;
}

export type BoardCreatedOp = OpEnvelope<
  "board.created",
  { workspaceId: WorkspaceId; boardId: BoardId; name: string }
>;
export type ListCreatedOp = OpEnvelope<
  "list.created",
  { boardId: BoardId; listId: ListId; name: string; position: number }
>;
export type ListMovedOp = OpEnvelope<"list.moved", { listId: ListId; position: number }>;
export type CardCreatedOp = OpEnvelope<
  "card.created",
  { boardId: BoardId; listId: ListId; cardId: CardId; title: string; position: number }
>;
export type CardMovedOp = OpEnvelope<
  "card.moved",
  { cardId: CardId; fromListId: ListId; toListId: ListId; position: number }
>;

export type CardUpdatedOp = OpEnvelope<
  "card.updated",
  {
    cardId: CardId;
    title?: string;
    description?: string;
    dueDate?: string | null;
    labels?: string[];
  }
>;

export type CardArchivedOp = OpEnvelope<"card.archived", { cardId: CardId; archived: boolean }>;

export type CommentAddedOp = OpEnvelope<
  "comment.added",
  { cardId: CardId; commentId: CommentId; text: string }
>;

export type ChecklistItemAddedOp = OpEnvelope<
  "checklist.itemAdded",
  { cardId: CardId; itemId: ChecklistItemId; text: string; position: number }
>;
export type ChecklistItemToggledOp = OpEnvelope<
  "checklist.itemToggled",
  { cardId: CardId; itemId: ChecklistItemId; checked: boolean }
>;
export type ChecklistItemRenamedOp = OpEnvelope<
  "checklist.itemRenamed",
  { cardId: CardId; itemId: ChecklistItemId; text: string }
>;
export type ChecklistItemRemovedOp = OpEnvelope<
  "checklist.itemRemoved",
  { cardId: CardId; itemId: ChecklistItemId }
>;

export type MemberAddedOp = OpEnvelope<
  "member.added",
  { boardId: BoardId; memberId: ActorId; role: MemberRole }
>;
export type MemberRoleChangedOp = OpEnvelope<
  "member.roleChanged",
  { boardId: BoardId; memberId: ActorId; role: MemberRole }
>;

export type AnyOp =
  | BoardCreatedOp
  | ListCreatedOp
  | ListMovedOp
  | CardCreatedOp
  | CardMovedOp
  | CardUpdatedOp
  | CardArchivedOp
  | CommentAddedOp
  | ChecklistItemAddedOp
  | ChecklistItemToggledOp
  | ChecklistItemRenamedOp
  | ChecklistItemRemovedOp
  | MemberAddedOp
  | MemberRoleChangedOp;

function padSeq(seq: number): string {
  return String(seq).padStart(16, "0");
}

function parseSeqFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d{16})-/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

async function listOpFilenames(opsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(opsDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function nextSeq(opsDir: string): Promise<number> {
  const names = await listOpFilenames(opsDir);
  let max = 0;
  for (const name of names) {
    const seq = parseSeqFromFilename(name);
    if (seq !== null && seq > max) max = seq;
  }
  return max + 1;
}

export interface AppendOpArgs<TType extends OpType> {
  repoPath: string;
  type: TType;
  actorId: ActorId;
  ts?: string;
  opId?: OpId;
  payload: AnyOp["payload"];
  git?: GitAdapter;
  commitMessage?: string;
}

export async function appendOp<TType extends OpType>(args: AppendOpArgs<TType>): Promise<AnyOp> {
  await readRepoFormat(args.repoPath);
  const opsDir = getOpsDir(args.repoPath);
  await fs.mkdir(opsDir, { recursive: true });

  while (true) {
    const seq = await nextSeq(opsDir);
    const opId = args.opId ?? newId();
    const ts = args.ts ?? new Date().toISOString();
    const op: AnyOp = {
      schemaVersion: 1,
      opId,
      seq,
      type: args.type,
      ts,
      actorId: args.actorId,
      payload: args.payload as AnyOp["payload"],
    } as AnyOp;

    const filename = `${padSeq(seq)}-${opId}.json`;
    const finalPath = path.join(opsDir, filename);
    const tmpPath = `${finalPath}.tmp.${process.pid}`;

    try {
      await fs.writeFile(tmpPath, JSON.stringify(op, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.rename(tmpPath, finalPath);

      if (args.git?.addAndCommitOp) {
        await args.git.addAndCommitOp(args.repoPath, finalPath);
      } else if (args.git?.add && args.git.commit) {
        await args.git.add(args.repoPath, finalPath);
        const message = args.commitMessage ?? `kanban: ${op.type} seq=${op.seq} opId=${op.opId}`;
        await args.git.commit(args.repoPath, message, { actorId: op.actorId, ts: op.ts });
      }

      return op;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      try {
        await fs.rm(tmpPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
      if (code === "EEXIST") continue;
      throw error;
    }
  }
}

export async function loadOps(repoPath: string): Promise<AnyOp[]> {
  const opsDir = getOpsDir(repoPath);
  const names = await listOpFilenames(opsDir);
  names.sort((a, b) => a.localeCompare(b));

  const ops: AnyOp[] = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(opsDir, name), "utf8");
    ops.push(JSON.parse(raw) as AnyOp);
  }

  ops.sort((a, b) => a.seq - b.seq || a.opId.localeCompare(b.opId));
  return ops;
}

export async function listOpsSince(repoPath: string, afterSeq: number): Promise<AnyOp[]> {
  const opsDir = getOpsDir(repoPath);
  const names = await listOpFilenames(opsDir);

  const candidates = names
    .map((name) => ({ name, seq: parseSeqFromFilename(name) }))
    .filter((x): x is { name: string; seq: number } => x.seq !== null && x.seq > afterSeq);

  candidates.sort((a, b) => a.name.localeCompare(b.name));

  const ops: AnyOp[] = [];
  for (const { name } of candidates) {
    const raw = await fs.readFile(path.join(opsDir, name), "utf8");
    ops.push(JSON.parse(raw) as AnyOp);
  }

  ops.sort((a, b) => a.seq - b.seq || a.opId.localeCompare(b.opId));
  return ops;
}

export interface OpsSubscription {
  close(): void;
}

export async function subscribeOps(args: {
  repoPath: string;
  afterSeq: number;
  onOps: (ops: AnyOp[]) => void;
  persistent?: boolean;
}): Promise<OpsSubscription> {
  const opsDir = getOpsDir(args.repoPath);
  await fs.mkdir(opsDir, { recursive: true });

  let lastSeq = args.afterSeq;
  let scheduled: NodeJS.Timeout | undefined;
  let closed = false;

  async function flush(): Promise<void> {
    if (closed) return;
    const newOps = await listOpsSince(args.repoPath, lastSeq);
    if (newOps.length === 0) return;
    for (const op of newOps) if (op.seq > lastSeq) lastSeq = op.seq;
    args.onOps(newOps);
  }

  function scheduleFlush(): void {
    if (closed) return;
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      flush().catch(() => {
        // best-effort watcher; ignore transient read/parse issues
      });
    }, 25);
  }

  const watcher = fsWatch.watch(opsDir, { persistent: args.persistent ?? true }, () => {
    scheduleFlush();
  });

  // If there were ops written after `afterSeq` before the watcher started, deliver them.
  scheduleFlush();

  return {
    close(): void {
      closed = true;
      if (scheduled) clearTimeout(scheduled);
      watcher.close();
    },
  };
}
