#!/usr/bin/env node
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

function isUsageErrorMessage(message: string): boolean {
  return (
    message.startsWith("Usage:") ||
    message.startsWith("Missing required flag:") ||
    message.startsWith("Missing --repo") ||
    message.startsWith("Missing command.")
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

function writeStderr(text: string): Promise<void> {
  return new Promise((resolve) => {
    process.stderr.write(text, () => resolve());
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const mode = decideMode(argv);

  if (mode === "cli") {
    return await runCli(argv);
  }

  try {
    await runTui(argv);
    return 0;
  } catch (err) {
    const message = errorMessage(err);
    if (isUsageErrorMessage(message)) {
      await writeStderr(`${message}\n`);
      await runCli(["--help"]);
      return 2;
    }
    await writeStderr(`${message}\n`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${errorMessage(err)}\n`);
    process.exitCode = 1;
  });
