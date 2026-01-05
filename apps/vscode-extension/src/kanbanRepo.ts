import path from "node:path";
import {
  archiveCard,
  addChecklistItem,
  addComment,
  createBoard,
  createCard,
  createList,
  initRepo,
  loadOps,
  moveCard,
  moveList,
  readRepoFormat,
  removeChecklistItem,
  rebuildState,
  renameBoard,
  renameChecklistItem,
  renameList,
  searchCards,
  toggleChecklistItem,
  updateCard,
  type ActorId,
  type BoardId,
  type CardId,
  type ChecklistItemId,
  type ListId,
  type OpType,
  type State,
} from "@a5c-ai/kanban-sdk";

export interface KanbanRepoClient {
  repoPath: string;
  ensureInitialized(): Promise<void>;
  loadState(): Promise<State>;
  createBoard(name: string, actorId: ActorId): Promise<BoardId>;
  renameBoard(boardId: BoardId, name: string, actorId: ActorId): Promise<void>;
  createList(boardId: BoardId, name: string, actorId: ActorId): Promise<ListId>;
  renameList(listId: ListId, name: string, actorId: ActorId): Promise<void>;
  moveList(listId: ListId, position: number, actorId: ActorId): Promise<void>;
  createCard(boardId: BoardId, listId: ListId, title: string, actorId: ActorId): Promise<CardId>;
  moveCard(cardId: CardId, toListId: ListId, position: number | undefined, actorId: ActorId): Promise<void>;
  updateCard(
    cardId: CardId,
    patch: { title?: string; description?: string; dueDate?: string | null; labels?: string[] },
    actorId: ActorId,
  ): Promise<void>;
  archiveCard(cardId: CardId, archived: boolean, actorId: ActorId): Promise<void>;
  addComment(cardId: CardId, text: string, actorId: ActorId): Promise<void>;
  addChecklistItem(cardId: CardId, text: string, actorId: ActorId): Promise<ChecklistItemId>;
  toggleChecklistItem(
    cardId: CardId,
    itemId: ChecklistItemId,
    checked: boolean,
    actorId: ActorId,
  ): Promise<void>;
  renameChecklistItem(
    cardId: CardId,
    itemId: ChecklistItemId,
    text: string,
    actorId: ActorId,
  ): Promise<void>;
  removeChecklistItem(cardId: CardId, itemId: ChecklistItemId, actorId: ActorId): Promise<void>;
  searchCards(
    query: string,
  ): Promise<Array<{ cardId: CardId; boardId: BoardId; listId: ListId; title: string }>>;
  getCardHistory(cardId: CardId): Promise<
    Array<{ ts: string; actorId: ActorId; type: OpType; summary: string; seq: number; opId: string }>
  >;
}

export function createKanbanRepoClient(repoPath: string): KanbanRepoClient {
  const normalized = path.resolve(repoPath);
  return {
    repoPath: normalized,
    async ensureInitialized(): Promise<void> {
      await initRepo({ path: normalized });
      await readRepoFormat(normalized);
    },
    async loadState(): Promise<State> {
      const { state } = await rebuildState(normalized);
      return state;
    },
    async createBoard(name: string, actorId: ActorId): Promise<BoardId> {
      return createBoard({ repoPath: normalized, name, actorId });
    },
    async renameBoard(boardId: BoardId, name: string, actorId: ActorId): Promise<void> {
      await renameBoard({ repoPath: normalized, boardId, name, actorId });
    },
    async createList(boardId: BoardId, name: string, actorId: ActorId): Promise<ListId> {
      return createList({ repoPath: normalized, boardId, name, actorId });
    },
    async renameList(listId: ListId, name: string, actorId: ActorId): Promise<void> {
      await renameList({ repoPath: normalized, listId, name, actorId });
    },
    async moveList(listId: ListId, position: number, actorId: ActorId): Promise<void> {
      await moveList({ repoPath: normalized, listId, position, actorId });
    },
    async createCard(
      boardId: BoardId,
      listId: ListId,
      title: string,
      actorId: ActorId,
    ): Promise<CardId> {
      return createCard({ repoPath: normalized, boardId, listId, title, actorId });
    },
    async moveCard(
      cardId: CardId,
      toListId: ListId,
      position: number | undefined,
      actorId: ActorId,
    ): Promise<void> {
      await moveCard({ repoPath: normalized, cardId, toListId, position, actorId });
    },
    async updateCard(cardId: CardId, patch, actorId: ActorId): Promise<void> {
      await updateCard({ repoPath: normalized, cardId, actorId, ...patch });
    },
    async archiveCard(cardId: CardId, archived: boolean, actorId: ActorId): Promise<void> {
      await archiveCard({ repoPath: normalized, cardId, archived, actorId });
    },
    async addComment(cardId: CardId, text: string, actorId: ActorId): Promise<void> {
      await addComment({ repoPath: normalized, cardId, text, actorId });
    },
    async addChecklistItem(cardId: CardId, text: string, actorId: ActorId): Promise<ChecklistItemId> {
      return addChecklistItem({ repoPath: normalized, cardId, text, actorId });
    },
    async toggleChecklistItem(
      cardId: CardId,
      itemId: ChecklistItemId,
      checked: boolean,
      actorId: ActorId,
    ): Promise<void> {
      await toggleChecklistItem({ repoPath: normalized, cardId, itemId, checked, actorId });
    },
    async renameChecklistItem(
      cardId: CardId,
      itemId: ChecklistItemId,
      text: string,
      actorId: ActorId,
    ): Promise<void> {
      await renameChecklistItem({ repoPath: normalized, cardId, itemId, text, actorId });
    },
    async removeChecklistItem(cardId: CardId, itemId: ChecklistItemId, actorId: ActorId): Promise<void> {
      await removeChecklistItem({ repoPath: normalized, cardId, itemId, actorId });
    },
    async searchCards(query: string) {
      return searchCards(normalized, query);
    },
    async getCardHistory(cardId: CardId) {
      const ops = await loadOps(normalized);
      const history = ops
        .filter((op) => {
          const p = op.payload as { cardId?: string };
          return p?.cardId === cardId;
        })
        .map((op) => {
          const p = op.payload as any;
          const summary = (() => {
            switch (op.type) {
              case "card.created":
                return `Created: ${String(p.title ?? "")}`.trim();
              case "card.updated": {
                const parts: string[] = [];
                if (typeof p.title === "string") parts.push("title");
                if (typeof p.description === "string") parts.push("description");
                if (typeof p.dueDate === "string" || p.dueDate === null) parts.push("due date");
                if (Array.isArray(p.labels)) parts.push("labels");
                return parts.length > 0 ? `Updated: ${parts.join(", ")}` : "Updated";
              }
              case "card.moved":
                return `Moved to list ${String(p.toListId ?? "")}`.trim();
              case "card.archived":
                return p.archived ? "Archived" : "Unarchived";
              case "comment.added":
                return "Comment added";
              case "checklist.itemAdded":
                return `Checklist: added "${String(p.text ?? "")}"`.trim();
              case "checklist.itemToggled":
                return `Checklist: ${p.checked ? "checked" : "unchecked"}`;
              case "checklist.itemRenamed":
                return `Checklist: renamed to "${String(p.text ?? "")}"`.trim();
              case "checklist.itemRemoved":
                return "Checklist: removed item";
              default:
                return op.type;
            }
          })();
          return { ts: op.ts, actorId: op.actorId, type: op.type, summary, seq: op.seq, opId: op.opId };
        })
        .sort((a, b) => (a.seq - b.seq) || a.opId.localeCompare(b.opId));
      return history;
    },
  };
}
