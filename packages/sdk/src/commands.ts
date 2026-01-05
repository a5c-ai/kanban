import {
  newId,
  type ActorId,
  type BoardId,
  type CardId,
  type ChecklistItemId,
  type CommentId,
  type ListId,
  type WorkspaceId,
} from "./ids";
import type { MemberRole, State } from "./model";
import type { GitAdapter } from "./git";
import { appendOp } from "./ops";
import { rebuildState } from "./state";
import { readRepoFormat } from "./repo";

function nextPosition(existing: number[]): number {
  let max = 0;
  for (const n of existing) if (n > max) max = n;
  return max === 0 ? 1000 : max + 1000;
}

function getBoardRole(state: State, boardId: BoardId, actorId: ActorId): MemberRole | undefined {
  return state.memberships[boardId]?.[actorId];
}

function assertCanEditBoard(state: State, boardId: BoardId, actorId: ActorId): void {
  const memberships = state.memberships[boardId];
  const hasAnyMembership = memberships && Object.keys(memberships).length > 0;

  // Bootstrap rule: if a board has no membership records yet, allow edits.
  // Git remote ACLs remain the hard boundary in v1; in-repo membership is primarily for UX.
  if (!hasAnyMembership) return;

  const role = getBoardRole(state, boardId, actorId);
  if (role !== "editor") {
    throw new Error(
      `Permission denied: actorId=${actorId} role=${role ?? "none"} boardId=${boardId}`,
    );
  }
}

export async function createBoard(args: {
  repoPath: string;
  name: string;
  actorId: ActorId;
  workspaceId?: WorkspaceId;
  git?: GitAdapter;
}): Promise<BoardId> {
  const format = await readRepoFormat(args.repoPath);
  const boardId = newId();
  const workspaceId = args.workspaceId ?? format.defaultWorkspaceId;

  await appendOp({
    repoPath: args.repoPath,
    type: "board.created",
    actorId: args.actorId,
    git: args.git,
    payload: { workspaceId, boardId, name: args.name },
  });

  return boardId;
}

export async function renameBoard(args: {
  repoPath: string;
  boardId: BoardId;
  name: string;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const board = state.boards[args.boardId];
  if (!board) throw new Error(`Board not found: ${args.boardId}`);
  assertCanEditBoard(state, args.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "board.renamed",
    actorId: args.actorId,
    git: args.git,
    payload: { boardId: args.boardId, name: args.name },
  });
}

export async function createList(args: {
  repoPath: string;
  boardId: BoardId;
  name: string;
  actorId: ActorId;
  position?: number;
  git?: GitAdapter;
}): Promise<ListId> {
  const { state } = await rebuildState(args.repoPath);
  const listId = newId();
  const board = state.boards[args.boardId];
  if (!board) throw new Error(`Board not found: ${args.boardId}`);
  assertCanEditBoard(state, args.boardId, args.actorId);

  const position =
    args.position ?? nextPosition(board.listIds.map((id) => state.lists[id]?.position ?? 0));

  await appendOp({
    repoPath: args.repoPath,
    type: "list.created",
    actorId: args.actorId,
    git: args.git,
    payload: { boardId: args.boardId, listId, name: args.name, position },
  });

  return listId;
}

export async function renameList(args: {
  repoPath: string;
  listId: ListId;
  name: string;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const list = state.lists[args.listId];
  if (!list) throw new Error(`List not found: ${args.listId}`);
  assertCanEditBoard(state, list.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "list.renamed",
    actorId: args.actorId,
    git: args.git,
    payload: { listId: args.listId, name: args.name },
  });
}

export async function moveList(args: {
  repoPath: string;
  listId: ListId;
  position: number;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const list = state.lists[args.listId];
  if (!list) throw new Error(`List not found: ${args.listId}`);
  assertCanEditBoard(state, list.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "list.moved",
    actorId: args.actorId,
    git: args.git,
    payload: { listId: args.listId, position: args.position },
  });
}

export async function createCard(args: {
  repoPath: string;
  boardId: BoardId;
  listId: ListId;
  title: string;
  actorId: ActorId;
  position?: number;
  git?: GitAdapter;
}): Promise<CardId> {
  const { state } = await rebuildState(args.repoPath);
  const cardId = newId();
  const list = state.lists[args.listId];
  if (!list) throw new Error(`List not found: ${args.listId}`);
  if (list.boardId !== args.boardId)
    throw new Error(`List ${args.listId} does not belong to board ${args.boardId}`);
  assertCanEditBoard(state, args.boardId, args.actorId);

  const position =
    args.position ?? nextPosition(list.cardIds.map((id) => state.cards[id]?.position ?? 0));

  await appendOp({
    repoPath: args.repoPath,
    type: "card.created",
    actorId: args.actorId,
    git: args.git,
    payload: { boardId: args.boardId, listId: args.listId, cardId, title: args.title, position },
  });

  return cardId;
}

export async function updateCard(args: {
  repoPath: string;
  cardId: CardId;
  actorId: ActorId;
  title?: string;
  description?: string;
  dueDate?: string | null;
  labels?: string[];
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "card.updated",
    actorId: args.actorId,
    git: args.git,
    payload: {
      cardId: args.cardId,
      title: args.title,
      description: args.description,
      dueDate: args.dueDate,
      labels: args.labels,
    },
  });
}

export async function archiveCard(args: {
  repoPath: string;
  cardId: CardId;
  archived: boolean;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "card.archived",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, archived: args.archived },
  });
}

export async function addComment(args: {
  repoPath: string;
  cardId: CardId;
  text: string;
  actorId: ActorId;
  commentId?: CommentId;
  git?: GitAdapter;
}): Promise<CommentId> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  const commentId = args.commentId ?? newId();
  await appendOp({
    repoPath: args.repoPath,
    type: "comment.added",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, commentId, text: args.text },
  });
  return commentId;
}

export async function addChecklistItem(args: {
  repoPath: string;
  cardId: CardId;
  text: string;
  actorId: ActorId;
  itemId?: ChecklistItemId;
  position?: number;
  git?: GitAdapter;
}): Promise<ChecklistItemId> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  const itemId = args.itemId ?? newId();
  const position =
    args.position ??
    nextPosition(
      (card.checklist ?? []).map((it) => (typeof it.position === "number" ? it.position : 0)),
    );

  await appendOp({
    repoPath: args.repoPath,
    type: "checklist.itemAdded",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, itemId, text: args.text, position },
  });
  return itemId;
}

export async function toggleChecklistItem(args: {
  repoPath: string;
  cardId: CardId;
  itemId: ChecklistItemId;
  checked: boolean;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "checklist.itemToggled",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, itemId: args.itemId, checked: args.checked },
  });
}

export async function renameChecklistItem(args: {
  repoPath: string;
  cardId: CardId;
  itemId: ChecklistItemId;
  text: string;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "checklist.itemRenamed",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, itemId: args.itemId, text: args.text },
  });
}

export async function removeChecklistItem(args: {
  repoPath: string;
  cardId: CardId;
  itemId: ChecklistItemId;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  await appendOp({
    repoPath: args.repoPath,
    type: "checklist.itemRemoved",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, itemId: args.itemId },
  });
}

export async function moveCard(args: {
  repoPath: string;
  cardId: CardId;
  toListId: ListId;
  actorId: ActorId;
  position?: number;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  const card = state.cards[args.cardId];
  if (!card) throw new Error(`Card not found: ${args.cardId}`);
  assertCanEditBoard(state, card.boardId, args.actorId);

  const toList = state.lists[args.toListId];
  if (!toList) throw new Error(`List not found: ${args.toListId}`);
  if (toList.boardId !== card.boardId) throw new Error(`Cannot move card across boards in v1`);

  const position =
    args.position ?? nextPosition(toList.cardIds.map((id) => state.cards[id]?.position ?? 0));

  await appendOp({
    repoPath: args.repoPath,
    type: "card.moved",
    actorId: args.actorId,
    git: args.git,
    payload: { cardId: args.cardId, fromListId: card.listId, toListId: args.toListId, position },
  });
}

export async function addMember(args: {
  repoPath: string;
  boardId: BoardId;
  memberId: ActorId;
  role: MemberRole;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  if (!state.boards[args.boardId]) throw new Error(`Board not found: ${args.boardId}`);
  assertCanEditBoard(state, args.boardId, args.actorId);
  if (state.memberships[args.boardId]?.[args.memberId])
    throw new Error(`Member already exists on board: ${args.memberId}`);

  await appendOp({
    repoPath: args.repoPath,
    type: "member.added",
    actorId: args.actorId,
    git: args.git,
    payload: { boardId: args.boardId, memberId: args.memberId, role: args.role },
  });
}

export async function changeMemberRole(args: {
  repoPath: string;
  boardId: BoardId;
  memberId: ActorId;
  role: MemberRole;
  actorId: ActorId;
  git?: GitAdapter;
}): Promise<void> {
  const { state } = await rebuildState(args.repoPath);
  if (!state.boards[args.boardId]) throw new Error(`Board not found: ${args.boardId}`);
  assertCanEditBoard(state, args.boardId, args.actorId);
  if (!state.memberships[args.boardId]?.[args.memberId])
    throw new Error(`Member not found on board: ${args.memberId}`);

  await appendOp({
    repoPath: args.repoPath,
    type: "member.roleChanged",
    actorId: args.actorId,
    git: args.git,
    payload: { boardId: args.boardId, memberId: args.memberId, role: args.role },
  });
}
