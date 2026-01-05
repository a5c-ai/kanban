import process from "node:process";
import type { Board, Card, List, State } from "@a5c-ai/kanban-sdk";

export function printState(state: State): void {
  const ws = state.workspaces[state.defaultWorkspaceId];
  process.stdout.write(`\nWorkspace: ${ws?.name ?? "Default"} (${state.defaultWorkspaceId})\n`);

  const boardIds = ws?.boardIds ?? Object.keys(state.boards);
  if (boardIds.length === 0) {
    process.stdout.write("No boards.\n");
    return;
  }

  for (const boardId of boardIds) {
    const board = state.boards[boardId];
    if (!board) continue;
    process.stdout.write(`\nBoard: ${board.name} (${board.id})\n`);
    if (board.listIds.length === 0) {
      process.stdout.write("  (no lists)\n");
      continue;
    }
    for (const listId of board.listIds) {
      const list = state.lists[listId];
      if (!list) continue;
      process.stdout.write(`  List: ${list.name} (${list.id})\n`);
      if (list.cardIds.length === 0) {
        process.stdout.write("    (no cards)\n");
        continue;
      }
      for (const cardId of list.cardIds) {
        const card = state.cards[cardId];
        if (!card) continue;
        if (card.archived) continue;
        const labels = card.labels?.length ? ` [${card.labels.join(", ")}]` : "";
        const due = card.dueDate ? ` due=${card.dueDate}` : "";
        process.stdout.write(`    - ${card.title}${labels}${due} (${card.id})\n`);
      }
    }
  }
  process.stdout.write("\n(note: archived cards hidden; use 'card archive/unarchive' to toggle)\n");
  if (state.conflicts.length > 0) {
    process.stdout.write(
      `(conflicts detected: ${state.conflicts.length}; use 'state conflicts' to view)\n`,
    );
  }
}

export function boardList(state: State): Board[] {
  const ws = state.workspaces[state.defaultWorkspaceId];
  const ids = ws?.boardIds ?? Object.keys(state.boards);
  return ids.map((id) => state.boards[id]).filter((b): b is Board => !!b);
}

export function listList(state: State, board: Board): List[] {
  return board.listIds.map((id) => state.lists[id]).filter((l): l is List => !!l);
}

export function cardsForBoard(state: State, board: Board): Card[] {
  const cards: Card[] = [];
  for (const listId of board.listIds) {
    const list = state.lists[listId];
    if (!list) continue;
    for (const cardId of list.cardIds) {
      const card = state.cards[cardId];
      if (card) cards.push(card);
    }
  }
  return cards;
}
