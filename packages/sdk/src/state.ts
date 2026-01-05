import type { AnyOp } from "./ops";
import { createEmptyState, type Conflict, type State } from "./model";
import type { CardId, ChecklistItemId, CommentId, ListId } from "./ids";
import { loadOps } from "./ops";
import { readRepoFormat } from "./repo";

function sortIdsByPosition<TId extends string>(
  ids: TId[],
  positionById: (id: TId) => number,
): TId[] {
  return [...ids].sort((a, b) => {
    const pa = positionById(a);
    const pb = positionById(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function sortChecklistByPosition(items: State["cards"][CardId]["checklist"]): typeof items {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}

function removeFromArray<T>(arr: T[], value: T): void {
  const idx = arr.indexOf(value);
  if (idx >= 0) arr.splice(idx, 1);
}

function removeChecklistItem(
  items: State["cards"][CardId]["checklist"],
  itemId: ChecklistItemId,
): void {
  const idx = items.findIndex((it) => it.id === itemId);
  if (idx >= 0) items.splice(idx, 1);
}

type Write = {
  entityType: Conflict["entityType"];
  entityId: string;
  field: string;
  value: unknown;
  opId: string;
  ts: string;
  actorId: string;
  seq: number;
};

function writesForOp(op: AnyOp): Write[] {
  switch (op.type) {
    case "board.renamed": {
      const p = op.payload as { boardId: string; name: string };
      return [
        {
          entityType: "board",
          entityId: p.boardId,
          field: "name",
          value: p.name,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "list.renamed": {
      const p = op.payload as { listId: string; name: string };
      return [
        {
          entityType: "list",
          entityId: p.listId,
          field: "name",
          value: p.name,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "list.moved": {
      const p = op.payload as { listId: string; position: number };
      return [
        {
          entityType: "list",
          entityId: p.listId,
          field: "position",
          value: p.position,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "card.updated": {
      const p = op.payload as {
        cardId: string;
        title?: string;
        description?: string;
        dueDate?: string | null;
        labels?: string[];
      };
      const writes: Write[] = [];
      if (typeof p.title === "string")
        writes.push({
          entityType: "card",
          entityId: p.cardId,
          field: "title",
          value: p.title,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        });
      if (typeof p.description === "string")
        writes.push({
          entityType: "card",
          entityId: p.cardId,
          field: "description",
          value: p.description,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        });
      if (typeof p.dueDate === "string" || p.dueDate === null)
        writes.push({
          entityType: "card",
          entityId: p.cardId,
          field: "dueDate",
          value: p.dueDate,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        });
      if (Array.isArray(p.labels))
        writes.push({
          entityType: "card",
          entityId: p.cardId,
          field: "labels",
          value: p.labels,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        });
      return writes;
    }
    case "card.moved": {
      const p = op.payload as { cardId: string; toListId: string; position: number };
      return [
        {
          entityType: "card",
          entityId: p.cardId,
          field: "listId",
          value: p.toListId,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
        {
          entityType: "card",
          entityId: p.cardId,
          field: "position",
          value: p.position,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "card.archived": {
      const p = op.payload as { cardId: string; archived: boolean };
      return [
        {
          entityType: "card",
          entityId: p.cardId,
          field: "archived",
          value: p.archived,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "list.moved": {
      const p = op.payload as { listId: string; position: number };
      return [
        {
          entityType: "list",
          entityId: p.listId,
          field: "position",
          value: p.position,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    case "member.added":
    case "member.roleChanged": {
      const p = op.payload as { boardId: string; memberId: string; role: string };
      return [
        {
          entityType: "membership",
          entityId: `${p.boardId}:${p.memberId}`,
          field: "role",
          value: p.role,
          opId: op.opId,
          ts: op.ts,
          actorId: op.actorId,
          seq: op.seq,
        },
      ];
    }
    default:
      return [];
  }
}

function stableValueKey(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : v));
}

function detectConflictsForSeqGroup(seqOps: AnyOp[]): Conflict[] {
  if (seqOps.length <= 1) return [];

  const byKey = new Map<string, Write[]>();
  for (const op of seqOps) {
    for (const w of writesForOp(op)) {
      const key = `${w.entityType}:${w.entityId}:${w.field}`;
      const arr = byKey.get(key);
      if (arr) arr.push(w);
      else byKey.set(key, [w]);
    }
  }

  const conflicts: Conflict[] = [];
  for (const [key, writes] of byKey.entries()) {
    if (writes.length <= 1) continue;
    const distinct = new Map<string, Write>();
    for (const w of writes) distinct.set(stableValueKey(w.value), w);
    if (distinct.size <= 1) continue;

    const sample = writes[0];
    const parts = key.split(":");
    const entityType = parts[0] as Conflict["entityType"];
    const entityId = parts.slice(1, parts.length - 1).join(":");
    const field = parts[parts.length - 1];

    conflicts.push({
      id: `seq:${sample.seq}:${entityType}:${entityId}:${field}`,
      seq: sample.seq,
      entityType,
      entityId,
      field,
      ops: writes.map((w) => ({
        opId: w.opId,
        ts: w.ts,
        actorId: w.actorId,
        value: w.value,
      })),
    });
  }

  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  return conflicts;
}

function applyOp(state: State, op: AnyOp): void {
  switch (op.type) {
    case "board.created": {
      const { workspaceId, boardId, name } = op.payload;
      if (!state.workspaces[workspaceId]) {
        state.workspaces[workspaceId] = { id: workspaceId, name: "Workspace", boardIds: [] };
      }
      if (!state.boards[boardId]) {
        state.boards[boardId] = { id: boardId, workspaceId, name, listIds: [] };
        state.workspaces[workspaceId].boardIds.push(boardId);
      }
      state.memberships[boardId] ??= {};
      state.memberships[boardId][op.actorId] ??= "editor";
      state.workspaces[workspaceId].boardIds.sort((a, b) => a.localeCompare(b));
      return;
    }
    case "board.renamed": {
      const { boardId, name } = op.payload;
      const board = state.boards[boardId];
      if (!board) return;
      board.name = name;
      return;
    }
    case "list.created": {
      const { boardId, listId, name, position } = op.payload;
      const board = state.boards[boardId];
      if (!board) return;
      if (!state.lists[listId]) {
        state.lists[listId] = { id: listId, boardId, name, position, cardIds: [] };
        board.listIds.push(listId);
      }
      board.listIds = sortIdsByPosition(
        board.listIds as ListId[],
        (id) => state.lists[id].position,
      );
      return;
    }
    case "list.renamed": {
      const { listId, name } = op.payload;
      const list = state.lists[listId];
      if (!list) return;
      list.name = name;
      return;
    }
    case "list.moved": {
      const { listId, position } = op.payload;
      const list = state.lists[listId];
      if (!list) return;
      list.position = position;
      const board = state.boards[list.boardId];
      if (!board) return;
      board.listIds = sortIdsByPosition(
        board.listIds as ListId[],
        (id) => state.lists[id].position,
      );
      return;
    }
    case "card.created": {
      const { boardId, listId, cardId, title, position } = op.payload;
      const list = state.lists[listId];
      if (!list) return;
      if (!state.cards[cardId]) {
        state.cards[cardId] = {
          id: cardId,
          boardId,
          listId,
          title,
          description: "",
          dueDate: null,
          labels: [],
          archived: false,
          position,
          checklist: [],
        };
        list.cardIds.push(cardId);
      }
      list.cardIds = sortIdsByPosition(list.cardIds as CardId[], (id) => state.cards[id].position);
      return;
    }
    case "card.moved": {
      const { cardId, fromListId, toListId, position } = op.payload;
      const card = state.cards[cardId];
      if (!card) return;
      const fromList = state.lists[fromListId];
      const toList = state.lists[toListId];
      if (!fromList || !toList) return;

      removeFromArray(fromList.cardIds, cardId);
      toList.cardIds.push(cardId);

      card.listId = toListId;
      card.position = position;

      fromList.cardIds = sortIdsByPosition(
        fromList.cardIds as CardId[],
        (id) => state.cards[id].position,
      );
      toList.cardIds = sortIdsByPosition(
        toList.cardIds as CardId[],
        (id) => state.cards[id].position,
      );
      return;
    }
    case "card.updated": {
      const { cardId, title, description, dueDate, labels } = op.payload;
      const card = state.cards[cardId];
      if (!card) return;
      if (typeof title === "string") card.title = title;
      if (typeof description === "string") card.description = description;
      if (typeof dueDate === "string" || dueDate === null) card.dueDate = dueDate;
      if (Array.isArray(labels)) card.labels = [...labels];
      return;
    }
    case "card.archived": {
      const { cardId, archived } = op.payload;
      const card = state.cards[cardId];
      if (!card) return;
      card.archived = archived;
      return;
    }
    case "comment.added": {
      const { cardId, commentId, text } = op.payload as {
        cardId: CardId;
        commentId: CommentId;
        text: string;
      };
      const card = state.cards[cardId];
      if (!card) return;
      state.commentsByCardId[cardId] ??= [];
      state.commentsByCardId[cardId].push({
        id: commentId,
        cardId,
        ts: op.ts,
        actorId: op.actorId,
        text,
      });
      return;
    }
    case "checklist.itemAdded": {
      const { cardId, itemId, text, position } = op.payload as {
        cardId: CardId;
        itemId: ChecklistItemId;
        text: string;
        position: number;
      };
      const card = state.cards[cardId];
      if (!card) return;
      if (!card.checklist.some((it) => it.id === itemId)) {
        card.checklist.push({ id: itemId, text, checked: false, position });
      }
      card.checklist = sortChecklistByPosition(card.checklist);
      return;
    }
    case "checklist.itemToggled": {
      const { cardId, itemId, checked } = op.payload as {
        cardId: CardId;
        itemId: ChecklistItemId;
        checked: boolean;
      };
      const card = state.cards[cardId];
      if (!card) return;
      const item = card.checklist.find((it) => it.id === itemId);
      if (!item) return;
      item.checked = checked;
      return;
    }
    case "checklist.itemRenamed": {
      const { cardId, itemId, text } = op.payload as {
        cardId: CardId;
        itemId: ChecklistItemId;
        text: string;
      };
      const card = state.cards[cardId];
      if (!card) return;
      const item = card.checklist.find((it) => it.id === itemId);
      if (!item) return;
      item.text = text;
      return;
    }
    case "checklist.itemRemoved": {
      const { cardId, itemId } = op.payload as { cardId: CardId; itemId: ChecklistItemId };
      const card = state.cards[cardId];
      if (!card) return;
      removeChecklistItem(card.checklist, itemId);
      return;
    }
    case "member.added": {
      const { boardId, memberId, role } = op.payload;
      if (!state.boards[boardId]) return;
      state.memberships[boardId] ??= {};
      state.memberships[boardId][memberId] ??= role;
      return;
    }
    case "member.roleChanged": {
      const { boardId, memberId, role } = op.payload;
      if (!state.boards[boardId]) return;
      state.memberships[boardId] ??= {};
      state.memberships[boardId][memberId] = role;
      return;
    }
  }
}

export interface RebuildResult {
  appliedThroughSeq: number;
  state: State;
}

export async function rebuildState(repoPath: string): Promise<RebuildResult> {
  const format = await readRepoFormat(repoPath);
  const ops = await loadOps(repoPath);
  const state = createEmptyState(format.defaultWorkspaceId);

  let appliedThroughSeq = 0;
  let i = 0;
  while (i < ops.length) {
    const seq = ops[i].seq;
    const group: AnyOp[] = [];
    while (i < ops.length && ops[i].seq === seq) {
      group.push(ops[i]);
      i += 1;
    }

    for (const c of detectConflictsForSeqGroup(group)) state.conflicts.push(c);

    for (const op of group) {
      applyOp(state, op);
      if (op.seq > appliedThroughSeq) appliedThroughSeq = op.seq;
    }
  }

  return { appliedThroughSeq, state };
}
