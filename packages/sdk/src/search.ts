import type { BoardId, CardId, ListId } from "./ids";
import { rebuildState } from "./state";

export interface CardSearchResult {
  cardId: CardId;
  boardId: BoardId;
  listId: ListId;
  title: string;
}

function normalizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export async function searchCards(repoPath: string, query: string): Promise<CardSearchResult[]> {
  const { state } = await rebuildState(repoPath);
  const needles = normalizeQuery(query);

  const matches: CardSearchResult[] = [];
  for (const cardId of Object.keys(state.cards) as CardId[]) {
    const card = state.cards[cardId];
    if (!card) continue;
    if (card.archived) continue;

    const hay = [
      card.title ?? "",
      card.description ?? "",
      ...(Array.isArray(card.labels) ? card.labels : []),
    ]
      .join("\n")
      .toLowerCase();
    if (needles.length > 0 && !needles.every((n) => hay.includes(n))) continue;

    matches.push({
      cardId,
      boardId: card.boardId,
      listId: card.listId,
      title: card.title,
    });
  }

  // Stable deterministic ordering: board, list, card position, then cardId.
  matches.sort((a, b) => {
    if (a.boardId !== b.boardId) return a.boardId.localeCompare(b.boardId);
    if (a.listId !== b.listId) return a.listId.localeCompare(b.listId);
    const pa = state.cards[a.cardId]?.position ?? 0;
    const pb = state.cards[b.cardId]?.position ?? 0;
    if (pa !== pb) return pa - pb;
    return a.cardId.localeCompare(b.cardId);
  });

  return matches;
}
