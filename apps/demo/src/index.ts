import path from "node:path";
import process from "node:process";
import {
  addMember,
  changeMemberRole,
  createBoard,
  createCard,
  createCliGitAdapter,
  createList,
  initRepo,
  moveCard,
  rebuildState,
} from "@trello-clone/sdk";

function parseArgs(argv: string[]): { repoPath: string } {
  const repoFlagIdx = argv.indexOf("--repo");
  if (repoFlagIdx !== -1 && argv[repoFlagIdx + 1]) {
    return { repoPath: path.resolve(argv[repoFlagIdx + 1]) };
  }

  const repoEquals = argv.find((a) => a.startsWith("--repo="));
  if (repoEquals) {
    const value = repoEquals.slice("--repo=".length);
    if (value) return { repoPath: path.resolve(value) };
  }

  const positional = argv.find((a) => !a.startsWith("-"));
  if (positional) return { repoPath: path.resolve(positional) };

  throw new Error("Usage: npm run demo -- --repo <path>");
}

async function main(): Promise<void> {
  const { repoPath } = parseArgs(process.argv.slice(2));
  const git = await createCliGitAdapter();

  const alice: string = "alice@demo";
  const bob: string = "bob@demo";

  await initRepo({ path: repoPath, git });

  const boardId = await createBoard({ repoPath, name: "Demo Board", actorId: alice, git });
  const todoListId = await createList({ repoPath, boardId, name: "To Do", actorId: alice, git });
  const doneListId = await createList({ repoPath, boardId, name: "Done", actorId: alice, git });
  const cardId = await createCard({
    repoPath,
    boardId,
    listId: todoListId,
    title: "Hello from SDK",
    actorId: alice,
    git,
  });

  await addMember({ repoPath, boardId, memberId: bob, role: "viewer", actorId: alice, git });

  try {
    await moveCard({ repoPath, cardId, toListId: doneListId, actorId: bob, git });
  } catch (err) {
    process.stderr.write(
      `Expected permission failure (viewer -> moveCard): ${(err as Error).message}\n`,
    );
  }

  await changeMemberRole({ repoPath, boardId, memberId: bob, role: "editor", actorId: alice, git });
  await moveCard({ repoPath, cardId, toListId: doneListId, actorId: bob, git });

  const materialized = await rebuildState(repoPath);
  process.stdout.write(JSON.stringify(materialized, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
