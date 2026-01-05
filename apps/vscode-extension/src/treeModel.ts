import type { BoardId, CardId, ListId, State } from "@a5c-ai/kanban-sdk";

export type KanbanNode =
  | { kind: "root"; id: "root"; label: string; description?: string }
  | { kind: "board"; id: BoardId; label: string; description?: string }
  | { kind: "list"; id: ListId; boardId: BoardId; label: string; description?: string }
  | {
      kind: "card";
      id: CardId;
      boardId: BoardId;
      listId: ListId;
      label: string;
      description?: string;
      archived: boolean;
    };

export function buildRootNode(): KanbanNode {
  return { kind: "root", id: "root", label: "Kanban" };
}

export function getChildren(state: State, node: KanbanNode): KanbanNode[] {
  if (node.kind === "root") {
    return Object.values(state.boards)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => ({
        kind: "board",
        id: b.id,
        label: b.name,
        description: `${b.listIds.length} lists`,
      }));
  }

  if (node.kind === "board") {
    const board = state.boards[node.id];
    if (!board) return [];
    return board.listIds
      .map((listId) => state.lists[listId])
      .filter(Boolean)
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map((l) => ({
        kind: "list",
        id: l!.id,
        boardId: l!.boardId,
        label: l!.name,
        description: `${l!.cardIds.length} cards`,
      }));
  }

  if (node.kind === "list") {
    const list = state.lists[node.id];
    if (!list) return [];
    return list.cardIds
      .map((cardId) => state.cards[cardId])
      .filter(Boolean)
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map((c) => ({
        kind: "card",
        id: c!.id,
        boardId: c!.boardId,
        listId: c!.listId,
        label: c!.title,
        description: c!.archived ? "archived" : undefined,
        archived: c!.archived,
      }));
  }

  return [];
}
