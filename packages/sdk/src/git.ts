import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitRemoteRef {
  remote?: string;
  branch?: string;
}

export interface GitStatus {
  branch?: string;
  ahead?: number;
  behind?: number;
  dirty: boolean;
  porcelain: string;
}

export interface GitCommitOptions {
  actorId?: string;
  ts?: string;
}

export interface GitAdapter {
  init?(repoPath: string): Promise<void>;
  add?(repoPath: string, filePaths: string[] | string): Promise<void>;
  commit?(repoPath: string, message: string, options?: GitCommitOptions): Promise<void>;
  status?(repoPath: string): Promise<GitStatus>;
  fetch?(repoPath: string, ref?: GitRemoteRef): Promise<void>;
  pull?(repoPath: string, ref?: GitRemoteRef): Promise<void>;
  push?(repoPath: string, ref?: GitRemoteRef): Promise<void>;

  // Back-compat for the initial stub interface
  initRepo?(repoPath: string): Promise<void>;
  addAndCommitOp?(repoPath: string, opFilePath: string): Promise<void>;
  sync?(repoPath: string): Promise<void>;
}

export const NoopGitAdapter: GitAdapter = {
  async status(): Promise<GitStatus> {
    return { dirty: false, porcelain: "" };
  },
};

function actorIdToAuthor(actorId: string | undefined): { name: string; email: string } | undefined {
  if (!actorId) return undefined;
  const trimmed = actorId.trim();
  if (!trimmed) return undefined;
  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1].trim() || angleMatch[2].trim();
    const email = angleMatch[2].trim();
    return { name, email };
  }
  if (trimmed.includes("@")) return { name: trimmed.split("@")[0] || trimmed, email: trimmed };
  return { name: trimmed, email: `${trimmed}@local` };
}

function toGitPath(p: string): string {
  return p.replaceAll("\\", "/");
}

async function runGit(args: {
  repoPath: string;
  gitCommand: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const { stdout } = await execFileAsync(args.gitCommand, args.argv, {
    cwd: args.repoPath,
    windowsHide: true,
    env: { ...process.env, ...args.env },
  });
  return stdout.toString();
}

export async function isGitAvailable(gitCommand = "git"): Promise<boolean> {
  try {
    await execFileAsync(gitCommand, ["--version"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function createCliGitAdapter(args?: { gitCommand?: string }): Promise<GitAdapter> {
  const gitCommand = args?.gitCommand ?? "git";
  const available = await isGitAvailable(gitCommand);
  if (!available) return NoopGitAdapter;

  const adapter: GitAdapter = {
    async init(repoPath: string): Promise<void> {
      await runGit({ repoPath, gitCommand, argv: ["init"] });
    },
    async add(repoPath: string, filePaths: string[] | string): Promise<void> {
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      const relPaths = paths.map((p) => toGitPath(path.relative(repoPath, p)));
      await runGit({ repoPath, gitCommand, argv: ["add", "--", ...relPaths] });
    },
    async commit(repoPath: string, message: string, options?: GitCommitOptions): Promise<void> {
      const author = actorIdToAuthor(options?.actorId) ?? { name: "kanban", email: "kanban@local" };
      const env: NodeJS.ProcessEnv = {};
      env.GIT_AUTHOR_NAME = author.name;
      env.GIT_AUTHOR_EMAIL = author.email;
      env.GIT_COMMITTER_NAME = author.name;
      env.GIT_COMMITTER_EMAIL = author.email;
      if (options?.ts) {
        env.GIT_AUTHOR_DATE = options.ts;
        env.GIT_COMMITTER_DATE = options.ts;
      }
      await runGit({ repoPath, gitCommand, argv: ["commit", "-m", message, "--no-gpg-sign"], env });
    },
    async status(repoPath: string): Promise<GitStatus> {
      const porcelain = await runGit({
        repoPath,
        gitCommand,
        argv: ["status", "--porcelain=v1", "-b"],
      });
      const lines = porcelain.split(/\r?\n/).filter(Boolean);
      let branch: string | undefined;
      let ahead: number | undefined;
      let behind: number | undefined;
      if (lines[0]?.startsWith("## ")) {
        const header = lines[0].slice(3);
        const match = header.match(
          /^([^\s.]+)(?:\.\.\.[^\s]+)?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?$/,
        );
        if (match) {
          branch = match[1];
          if (match[2]) ahead = Number.parseInt(match[2], 10);
          if (match[3]) behind = Number.parseInt(match[3], 10);
        }
      }
      const dirty = lines.slice(1).some((l) => l.trim().length > 0);
      return { branch, ahead, behind, dirty, porcelain };
    },
    async fetch(repoPath: string, ref?: GitRemoteRef): Promise<void> {
      const remote = ref?.remote;
      const argv = remote ? ["fetch", "--prune", remote] : ["fetch", "--all", "--prune"];
      await runGit({ repoPath, gitCommand, argv });
    },
    async pull(repoPath: string, ref?: GitRemoteRef): Promise<void> {
      const remote = ref?.remote;
      const branch = ref?.branch;
      const argv = remote && branch ? ["pull", "--ff-only", remote, branch] : ["pull", "--ff-only"];
      await runGit({ repoPath, gitCommand, argv });
    },
    async push(repoPath: string, ref?: GitRemoteRef): Promise<void> {
      const remote = ref?.remote;
      const branch = ref?.branch;
      const argv = remote && branch ? ["push", remote, branch] : ["push"];
      await runGit({ repoPath, gitCommand, argv });
    },

    async initRepo(repoPath: string): Promise<void> {
      await adapter.init?.(repoPath);
    },
    async addAndCommitOp(repoPath: string, opFilePath: string): Promise<void> {
      await adapter.add?.(repoPath, opFilePath);
      await adapter.commit?.(repoPath, `kanban: op ${path.basename(opFilePath)}`);
    },
    async sync(repoPath: string): Promise<void> {
      await adapter.fetch?.(repoPath);
      await adapter.pull?.(repoPath);
      await adapter.push?.(repoPath);
    },
  };

  return adapter;
}
