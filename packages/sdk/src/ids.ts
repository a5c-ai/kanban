import crypto from "node:crypto";

export type WorkspaceId = string;
export type BoardId = string;
export type ListId = string;
export type CardId = string;
export type ChecklistItemId = string;
export type CommentId = string;
export type OpId = string;
export type ActorId = string;

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}
