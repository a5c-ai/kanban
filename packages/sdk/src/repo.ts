import fs from "node:fs/promises";
import path from "node:path";
import { newId, type WorkspaceId } from "./ids";
import type { GitAdapter } from "./git";

export interface RepoFormat {
  format: "kanban-git-repo";
  formatVersion: 1;
  createdAt: string;
  createdBy: {
    sdk: "@trello-clone/sdk";
    sdkVersion: string;
  };
  defaultWorkspaceId: WorkspaceId;
}

export interface InitRepoArgs {
  path: string;
  sdkVersion?: string;
  git?: GitAdapter;
}

export interface RepoHandle {
  repoPath: string;
  kanbanDir: string;
  opsDir: string;
  snapshotsDir: string;
  format: RepoFormat;
}

const FORMAT_FILENAME = "format.json";

export function getKanbanDir(repoPath: string): string {
  return path.join(repoPath, ".kanban");
}

export function getOpsDir(repoPath: string): string {
  return path.join(getKanbanDir(repoPath), "ops");
}

export function getSnapshotsDir(repoPath: string): string {
  return path.join(getKanbanDir(repoPath), "snapshots");
}

export function getFormatPath(repoPath: string): string {
  return path.join(getKanbanDir(repoPath), FORMAT_FILENAME);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function initRepo(args: InitRepoArgs): Promise<RepoHandle> {
  const repoPath = path.resolve(args.path);
  const kanbanDir = getKanbanDir(repoPath);
  const opsDir = getOpsDir(repoPath);
  const snapshotsDir = getSnapshotsDir(repoPath);
  const formatPath = getFormatPath(repoPath);

  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(kanbanDir, { recursive: true });
  await fs.mkdir(opsDir, { recursive: true });
  await fs.mkdir(snapshotsDir, { recursive: true });

  if (args.git?.init) await args.git.init(repoPath);
  else if (args.git?.initRepo) await args.git.initRepo(repoPath);

  let format: RepoFormat;
  if (await fileExists(formatPath)) {
    format = await readJsonFile<RepoFormat>(formatPath);
    if (format.format !== "kanban-git-repo" || format.formatVersion !== 1) {
      throw new Error(
        `Unsupported repo format: ${JSON.stringify({ format: format.format, formatVersion: format.formatVersion })}`,
      );
    }
  } else {
    format = {
      format: "kanban-git-repo",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      createdBy: {
        sdk: "@trello-clone/sdk",
        sdkVersion: args.sdkVersion ?? "0.1.0",
      },
      defaultWorkspaceId: newId(),
    };
    await fs.writeFile(formatPath, JSON.stringify(format, null, 2) + "\n", "utf8");
  }

  return { repoPath, kanbanDir, opsDir, snapshotsDir, format };
}

export async function readRepoFormat(repoPath: string): Promise<RepoFormat> {
  const format = await readJsonFile<RepoFormat>(getFormatPath(repoPath));
  if (format.format !== "kanban-git-repo" || format.formatVersion !== 1) {
    throw new Error(
      `Unsupported repo format: ${JSON.stringify({ format: format.format, formatVersion: format.formatVersion })}`,
    );
  }
  return format;
}
