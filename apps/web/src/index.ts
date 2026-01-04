import path from "node:path";
import process from "node:process";
import { createCliGitAdapter } from "@trello-clone/sdk";
import { main, parseArgs } from "./app";

async function run(): Promise<void> {
  const { repoPath, port } = parseArgs(process.argv.slice(2));
  const actorId = process.env.KANBAN_ACTOR_ID ?? "web@local";

  const git = await createCliGitAdapter();

  await main({
    repoPath: path.resolve(repoPath),
    port,
    actorId,
    git,
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
