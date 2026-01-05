import type { ActorId, BoardId, CardId, ChecklistItemId, ListId, State } from "@a5c-ai/kanban-sdk";
import type { KanbanRepoClient } from "../kanbanRepo";
import { toErrorMessage } from "../errors";

export type GetClient = () => { client: KanbanRepoClient; repoPath: string };
export type GetActorId = () => Promise<ActorId>;

export type WebviewToExtensionMessage =
  | { type: "ready"; requestId?: string }
  | { type: "refresh"; requestId?: string }
  | { type: "initRepo"; requestId?: string }
  | { type: "selectRepo"; requestId?: string }
  | { type: "setActiveBoard"; boardId: BoardId; requestId?: string }
  | { type: "createBoard"; name: string; requestId?: string }
  | { type: "renameBoard"; boardId: BoardId; name: string; requestId?: string }
  | { type: "createList"; boardId: BoardId; name: string; requestId?: string }
  | { type: "renameList"; listId: ListId; name: string; requestId?: string }
  | {
      type: "moveList";
      boardId: BoardId;
      listId: ListId;
      beforeListId?: ListId;
      afterListId?: ListId;
      requestId?: string;
    }
  | { type: "createCard"; boardId: BoardId; listId: ListId; title: string; requestId?: string }
  | {
      type: "moveCard";
      boardId: BoardId;
      cardId: CardId;
      toListId: ListId;
      beforeCardId?: CardId;
      afterCardId?: CardId;
      requestId?: string;
    }
  | {
      type: "updateCard";
      cardId: CardId;
      patch: { title?: string; description?: string; dueDate?: string | null; labels?: string[] };
      requestId?: string;
    }
  | { type: "archiveCard"; cardId: CardId; archived: boolean; requestId?: string }
  | {
      type: "saveCard";
      cardId: CardId;
      patch: { title?: string; description?: string; dueDate?: string | null; labels?: string[] };
      archived: boolean;
      requestId?: string;
    }
  | { type: "addChecklistItem"; cardId: CardId; text: string; requestId?: string }
  | {
      type: "toggleChecklistItem";
      cardId: CardId;
      itemId: ChecklistItemId;
      checked: boolean;
      requestId?: string;
    }
  | {
      type: "renameChecklistItem";
      cardId: CardId;
      itemId: ChecklistItemId;
      text: string;
      requestId?: string;
    }
  | { type: "removeChecklistItem"; cardId: CardId; itemId: ChecklistItemId; requestId?: string }
  | { type: "addComment"; cardId: CardId; text: string; requestId?: string }
  | { type: "searchCards"; query: string; requestId?: string }
  | { type: "getCardHistory"; cardId: CardId; requestId?: string }
  | { type: "openCard"; cardId: CardId; requestId?: string };

export type ExtensionToWebviewMessage =
  | { type: "state"; state: State | null; activeBoardId?: BoardId }
  | { type: "toast"; level: "info" | "error"; message: string }
  | {
      type: "opResult";
      requestId: string;
      ok: boolean;
      operation: WebviewToExtensionMessage["type"];
      safeToRetry?: boolean;
      error?: string;
    }
  | {
      type: "searchResults";
      query: string;
      results: Array<{ cardId: CardId; boardId: BoardId; listId: ListId; title: string }>;
    }
  | {
      type: "cardHistory";
      cardId: CardId;
      history: Array<{
        ts: string;
        actorId: ActorId;
        type: string;
        summary: string;
        seq: number;
        opId: string;
      }>;
    };

export type BoardViewMessageHandlerDeps = {
  getClientOrThrow: GetClient;
  getActorId: GetActorId;
  loadState: () => Promise<State>;
  onDidMutate: () => void;
  postMessage: (msg: ExtensionToWebviewMessage) => void;
  executeCommand: (
    command: "kanban.selectRepo" | "kanban.initRepo" | "kanban.openCard",
    ...args: unknown[]
  ) => Promise<void>;
};

function computeReorderPosition(prev?: number, next?: number): number {
  const step = 1000;
  if (typeof prev !== "number" && typeof next !== "number") return step;
  if (typeof prev !== "number") return (next ?? step) - step;
  if (typeof next !== "number") return prev + step;
  if (next - prev <= 1) return prev + 1;
  return Math.floor((prev + next) / 2);
}

function orderedListsForBoard(state: State, boardId: BoardId): Array<State["lists"][ListId]> {
  const board = state.boards[boardId];
  if (!board) return [];
  return board.listIds
    .map((id) => state.lists[id])
    .filter(Boolean)
    .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0) || a!.id.localeCompare(b!.id)) as Array<
    State["lists"][ListId]
  >;
}

function orderedCardsForList(state: State, listId: ListId): Array<State["cards"][CardId]> {
  const list = state.lists[listId];
  if (!list) return [];
  return list.cardIds
    .map((id) => state.cards[id])
    .filter(Boolean)
    .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0) || a!.id.localeCompare(b!.id)) as Array<
    State["cards"][CardId]
  >;
}

function isSafeToRetry(operation: WebviewToExtensionMessage["type"]): boolean {
  switch (operation) {
    case "renameBoard":
    case "renameList":
    case "moveList":
    case "moveCard":
    case "updateCard":
    case "archiveCard":
    case "saveCard":
    case "toggleChecklistItem":
    case "renameChecklistItem":
    case "removeChecklistItem":
    case "refresh":
    case "setActiveBoard":
      return true;
    case "ready":
    case "initRepo":
    case "selectRepo":
    case "createBoard":
    case "createList":
    case "createCard":
    case "addChecklistItem":
    case "addComment":
    case "searchCards":
    case "getCardHistory":
    case "openCard":
      return false;
  }
}

export function createBoardViewMessageHandler(deps: BoardViewMessageHandlerDeps) {
  const refresh = async (activeBoardId?: BoardId): Promise<void> => {
    try {
      const state = await deps.loadState();
      deps.postMessage({ type: "state", state, activeBoardId });
    } catch (error) {
      deps.postMessage({
        type: "toast",
        level: "error",
        message: `Failed to load state: ${toErrorMessage(error)}`,
      });
      deps.postMessage({ type: "state", state: null, activeBoardId });
    }
  };

  const withOpResult = async (
    msg: WebviewToExtensionMessage,
    fn: () => Promise<void>,
  ): Promise<void> => {
    try {
      await fn();
      if (msg.requestId) {
        deps.postMessage({
          type: "opResult",
          requestId: msg.requestId,
          ok: true,
          operation: msg.type,
        });
      }
    } catch (error) {
      const message = toErrorMessage(error);
      if (!msg.requestId) deps.postMessage({ type: "toast", level: "error", message });
      if (msg.requestId) {
        deps.postMessage({
          type: "opResult",
          requestId: msg.requestId,
          ok: false,
          operation: msg.type,
          safeToRetry: isSafeToRetry(msg.type),
          error: message,
        });
      }
      if (!msg.requestId) throw error;
    }
  };

  return async (msg: WebviewToExtensionMessage): Promise<void> => {
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "ready":
      case "refresh": {
        await refresh();
        if (msg.requestId)
          deps.postMessage({
            type: "opResult",
            requestId: msg.requestId,
            ok: true,
            operation: msg.type,
          });
        return;
      }
      case "selectRepo": {
        await withOpResult(msg, async () => {
          await deps.executeCommand("kanban.selectRepo");
          await refresh();
        });
        return;
      }
      case "initRepo": {
        await withOpResult(msg, async () => {
          await deps.executeCommand("kanban.initRepo");
          await refresh();
        });
        return;
      }
      case "setActiveBoard": {
        await withOpResult(msg, async () => {
          await refresh(msg.boardId);
        });
        return;
      }
      case "openCard": {
        await withOpResult(msg, async () => {
          await deps.executeCommand("kanban.openCard", msg.cardId);
        });
        return;
      }
      case "searchCards": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          await client.ensureInitialized();
          const results = await client.searchCards(msg.query);
          deps.postMessage({ type: "searchResults", query: msg.query, results });
        });
        return;
      }
      case "getCardHistory": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          await client.ensureInitialized();
          const history = await client.getCardHistory(msg.cardId);
          deps.postMessage({ type: "cardHistory", cardId: msg.cardId, history });
        });
        return;
      }
      case "createBoard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.createBoard(msg.name, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "renameBoard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.renameBoard(msg.boardId, msg.name, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "createList": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.createList(msg.boardId, msg.name, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "renameList": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.renameList(msg.listId, msg.name, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "moveList": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          const state = await client.loadState();
          const lists = orderedListsForBoard(state, msg.boardId).filter((l) => l.id !== msg.listId);
          const beforeIdx = msg.beforeListId
            ? lists.findIndex((l) => l.id === msg.beforeListId)
            : -1;
          const afterIdx = msg.afterListId ? lists.findIndex((l) => l.id === msg.afterListId) : -1;

          let prev: number | undefined;
          let next: number | undefined;
          if (beforeIdx >= 0) {
            next = lists[beforeIdx]?.position;
            prev = lists[beforeIdx - 1]?.position;
          } else if (afterIdx >= 0) {
            prev = lists[afterIdx]?.position;
            next = lists[afterIdx + 1]?.position;
          } else {
            prev = lists[lists.length - 1]?.position;
          }

          const position = computeReorderPosition(prev, next);
          await client.moveList(msg.listId, position, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "createCard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.createCard(msg.boardId, msg.listId, msg.title, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "moveCard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          const state = await client.loadState();
          const cards = orderedCardsForList(state, msg.toListId).filter((c) => c.id !== msg.cardId);
          const beforeIdx = msg.beforeCardId
            ? cards.findIndex((c) => c.id === msg.beforeCardId)
            : -1;
          const afterIdx = msg.afterCardId ? cards.findIndex((c) => c.id === msg.afterCardId) : -1;

          let prev: number | undefined;
          let next: number | undefined;
          if (beforeIdx >= 0) {
            next = cards[beforeIdx]?.position;
            prev = cards[beforeIdx - 1]?.position;
          } else if (afterIdx >= 0) {
            prev = cards[afterIdx]?.position;
            next = cards[afterIdx + 1]?.position;
          } else {
            prev = cards[cards.length - 1]?.position;
          }

          const position = computeReorderPosition(prev, next);
          await client.moveCard(msg.cardId, msg.toListId, position, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "updateCard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.updateCard(msg.cardId, msg.patch, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "archiveCard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.archiveCard(msg.cardId, msg.archived, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "saveCard": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.updateCard(msg.cardId, msg.patch, actorId);
          await client.archiveCard(msg.cardId, msg.archived, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "addChecklistItem": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.addChecklistItem(msg.cardId, msg.text, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "toggleChecklistItem": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.toggleChecklistItem(msg.cardId, msg.itemId, msg.checked, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "renameChecklistItem": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.renameChecklistItem(msg.cardId, msg.itemId, msg.text, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "removeChecklistItem": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.removeChecklistItem(msg.cardId, msg.itemId, actorId);
          deps.onDidMutate();
        });
        return;
      }
      case "addComment": {
        await withOpResult(msg, async () => {
          const { client } = deps.getClientOrThrow();
          const actorId = await deps.getActorId();
          await client.ensureInitialized();
          await client.addComment(msg.cardId, msg.text, actorId);
          deps.onDidMutate();
        });
        return;
      }
    }
  };
}
