import process from "node:process";
import { runCli } from "./cli";
import { runTui } from "./tui";

const KNOWN_CLI_TOP_LEVEL = new Set([
  "help",
  "repo",
  "state",
  "workspace",
  "board",
  "list",
  "card",
  "member",
  "search",
  "git",
]);

function isFlag(x: string): boolean {
  return x.startsWith("-");
}

function decideMode(argv: string[]): "cli" | "tui" {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") return "cli";
  if (argv.includes("--tui")) return "tui";

  const nonFlags = argv.filter((a) => !isFlag(a));
  const first = nonFlags[0];
  const second = nonFlags[1];
  if (first && KNOWN_CLI_TOP_LEVEL.has(first)) return "cli";
  if (second && KNOWN_CLI_TOP_LEVEL.has(second)) return "cli"; // <repoPath> <command> ...
  return "tui";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = decideMode(argv);

  if (mode === "cli") {
    const code = await runCli(argv);
    process.exit(code);
  }

  await runTui(argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
