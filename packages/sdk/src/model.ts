import type {
  ActorId,
  BoardId,
  CardId,
  ChecklistItemId,
  CommentId,
  ListId,
  WorkspaceId,
} from "./ids";

export type SchemaVersion = 1;

export interface Workspace {
  id: WorkspaceId;
  name: string;
  boardIds: BoardId[];
}

export interface Board {
  id: BoardId;
  workspaceId: WorkspaceId;
  name: string;
  listIds: ListId[];
}

export interface List {
  id: ListId;
  boardId: BoardId;
  name: string;
  position: number;
  cardIds: CardId[];
}

export interface Card {
  id: CardId;
  boardId: BoardId;
  listId: ListId;
  title: string;
  description: string;
  dueDate: string | null;
  labels: string[];
  archived: boolean;
  position: number;
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  id: ChecklistItemId;
  text: string;
  checked: boolean;
  position: number;
}

export interface Comment {
  id: CommentId;
  cardId: CardId;
  ts: string;
  actorId: ActorId;
  text: string;
}

export interface ConflictOpRef {
  opId: string;
  ts: string;
  actorId: ActorId;
  value: unknown;
}

export interface Conflict {
  id: string;
  seq: number;
  entityType: "card" | "list" | "board" | "membership";
  entityId: string;
  field: string;
  ops: ConflictOpRef[];
}

export type MemberRole = "viewer" | "editor";

export interface State {
  schemaVersion: SchemaVersion;
  defaultWorkspaceId: WorkspaceId;
  workspaces: Record<WorkspaceId, Workspace>;
  boards: Record<BoardId, Board>;
  lists: Record<ListId, List>;
  cards: Record<CardId, Card>;
  memberships: Record<BoardId, Record<ActorId, MemberRole>>;
  commentsByCardId: Record<CardId, Comment[]>;
  conflicts: Conflict[];
}

export function createEmptyState(defaultWorkspaceId: WorkspaceId): State {
  return {
    schemaVersion: 1,
    defaultWorkspaceId,
    workspaces: {
      [defaultWorkspaceId]: { id: defaultWorkspaceId, name: "Default", boardIds: [] },
    },
    boards: {},
    lists: {},
    cards: {},
    memberships: {},
    commentsByCardId: {},
    conflicts: [],
  };
}
