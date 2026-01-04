import path from "node:path";
import process from "node:process";
import {
  addChecklistItem,
  addComment,
  addMember,
  archiveCard,
  changeMemberRole,
  createBoard,
  createCard,
  createCliGitAdapter,
  createList,
  initRepo,
  moveCard,
  moveList,
  rebuildState,
  removeChecklistItem,
  renameChecklistItem,
  searchCards,
  toggleChecklistItem,
  updateCard,
  type MemberRole,
} from "@trello-clone/sdk";
import { boardList, cardsForBoard, listList, printState } from "./state-print";

type OutputMode = "human" | "json";

type GlobalOptions = {
  repoPath?: string;
  actorId: string;
  output: OutputMode;
};

type ParseResult = {
  globals: GlobalOptions;
  argv: string[];
};

function isFlag(x: string): boolean {
  return x.startsWith("-");
}

function takeFlagValue(argv: string[], i: number): { value?: string; nextIndex: number } {
  const eqIdx = argv[i]?.indexOf("=") ?? -1;
  if (eqIdx !== -1) return { value: argv[i]!.slice(eqIdx + 1), nextIndex: i + 1 };
  const next = argv[i + 1];
  if (next && !isFlag(next)) return { value: next, nextIndex: i + 2 };
  return { value: undefined, nextIndex: i + 1 };
}

function parseGlobalArgs(argv: string[]): ParseResult {
  const globals: GlobalOptions = {
    repoPath: undefined,
    actorId: process.env.KANBAN_ACTOR_ID ?? "cli@local",
    output: argv.includes("--json") ? "json" : "human",
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; ) {
    const a = argv[i]!;
    if (a === "--json") {
      i += 1;
      continue;
    }
    if (a === "--repo" || a.startsWith("--repo=")) {
      const { value, nextIndex } = takeFlagValue(argv, i);
      if (value) globals.repoPath = path.resolve(value);
      i = nextIndex;
      continue;
    }
    if (a === "--actor-id" || a.startsWith("--actor-id=")) {
      const { value, nextIndex } = takeFlagValue(argv, i);
      if (value) globals.actorId = value;
      i = nextIndex;
      continue;
    }
    rest.push(a);
    i += 1;
  }

  return { globals, argv: rest };
}

function printJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function usage(): string {
  return [
    "kanban (from apps/tui)",
    "",
    "Usage:",
    "  node apps/tui/dist/index.js --repo <path> <command> [subcommand] [flags]",
    "  node apps/tui/dist/index.js <repoPath> <command> [subcommand] [flags]",
    "  node apps/tui/dist/index.js --repo <path>            # interactive TUI",
    "",
    "Global flags:",
    "  --repo <path>          Repo path (or use positional repoPath before command)",
    "  --actor-id <id>        Actor id (default: $KANBAN_ACTOR_ID or cli@local)",
    "  --json                 JSON output (default: human)",
    "  -h, --help             Help",
    "",
    "Commands:",
    "  repo init",
    "  state print | state conflicts",
    "  workspace list | workspace show [--workspace-id <id>]",
    "  board list",
    "  board show --board-id <id>",
    "  board create --name <name> [--workspace-id <id>]",
    "  list list --board-id <id>",
    "  list show --list-id <id> [--include-archived]",
    "  list create --board-id <id> --name <name>",
    "  list move --list-id <id> --position <n>",
    "  card list (--board-id <id> | --list-id <id>) [--include-archived]",
    "  card show --card-id <id> [--include-comments]",
    "  card create --board-id <id> --list-id <id> --title <title>",
    "  card update --card-id <id> [--title <t>] [--description <d>] [--due-date <iso>] [--clear-due-date] [--labels a,b,c]",
    "  card move --card-id <id> --to-list-id <id>",
    "  card archive|unarchive --card-id <id>",
    "  card comment add --card-id <id> --text <text>",
    "  card checklist add --card-id <id> --text <text>",
    "  card checklist toggle --card-id <id> --item-id <id> --checked true|false",
    "  card checklist rename --card-id <id> --item-id <id> --text <text>",
    "  card checklist remove --card-id <id> --item-id <id>",
    "  member list --board-id <id>",
    "  member add --board-id <id> --member-id <id> --role viewer|editor",
    "  member role --board-id <id> --member-id <id> --role viewer|editor",
    "  search cards <query>",
    "  git status|fetch|pull|push|sync",
    "",
  ].join("\n");
}

function requireRepoPath(globals: GlobalOptions): string {
  if (!globals.repoPath) throw new Error("Missing --repo <path> (or provide positional repoPath).");
  return globals.repoPath;
}

function parseRepoPrefix(
  globals: GlobalOptions,
  argv: string[],
): { globals: GlobalOptions; argv: string[] } {
  if (globals.repoPath) return { globals, argv };
  const first = argv[0];
  if (!first || isFlag(first)) return { globals, argv };

  const known = new Set([
    "help",
    "repo",
    "state",
    "board",
    "list",
    "card",
    "member",
    "search",
    "git",
  ]);
  if (known.has(first)) return { globals, argv };
  return { globals: { ...globals, repoPath: path.resolve(first) }, argv: argv.slice(1) };
}

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1] && !isFlag(argv[idx + 1]!)) return argv[idx + 1]!;
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(`${name}=`.length);
  return undefined;
}

function readRequiredFlag(argv: string[], name: string): string {
  const v = readFlag(argv, name);
  if (!v) throw new Error(`Missing required flag: ${name}`);
  return v;
}

function stripFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      if (a.includes("=")) continue;
      if (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) i += 1;
      continue;
    }
    if (a === "-h") continue;
    out.push(a);
  }
  return out;
}

function roleFromString(raw: string): MemberRole {
  if (raw === "viewer" || raw === "editor") return raw;
  throw new Error(`Invalid role: ${raw} (expected: viewer|editor)`);
}

export async function runCli(rawArgv: string[]): Promise<number> {
  const help = rawArgv.includes("--help") || rawArgv.includes("-h") || rawArgv[0] === "help";
  if (help) {
    process.stdout.write(usage());
    return 0;
  }

  const parsed = parseGlobalArgs(rawArgv);
  const withRepoPrefix = parseRepoPrefix(parsed.globals, parsed.argv);
  const globals = withRepoPrefix.globals;
  const argv = withRepoPrefix.argv;

  const pos = stripFlags(argv);
  const cmd = pos[0];
  const sub = pos[1];

  const git = await createCliGitAdapter();

  try {
    if (!cmd) {
      throw new Error("Missing command. Use --help for usage.");
    }

    if (cmd === "repo") {
      if (sub !== "init") throw new Error("Usage: repo init");
      const repoPath = requireRepoPath(globals);
      const handle = await initRepo({ path: repoPath, git });
      if (globals.output === "json") printJson({ repoPath: handle.repoPath, format: handle.format });
      else process.stdout.write(`Initialized repo: ${handle.repoPath}\n`);
      return 0;
    }

    if (cmd === "state") {
      const action = sub ?? "print";
      const repoPath = requireRepoPath(globals);
      const { state, appliedThroughSeq } = await rebuildState(repoPath);

      if (action === "print") {
        if (globals.output === "json") printJson({ appliedThroughSeq, state });
        else printState(state);
        return 0;
      }

      if (action === "conflicts") {
        if (globals.output === "json") printJson({ conflicts: state.conflicts });
        else {
          if (!state.conflicts.length) {
            process.stdout.write("No conflicts.\n");
            return 0;
          }
          process.stdout.write("\nConflicts:\n");
          for (const c of state.conflicts.slice(0, 200)) {
            process.stdout.write(`- seq=${c.seq} ${c.entityType}:${c.entityId} field=${c.field}\n`);
            for (const o of c.ops) {
              process.stdout.write(`    * ${o.ts} ${o.actorId} opId=${o.opId}\n`);
            }
          }
        }
        return state.conflicts.length ? 1 : 0;
      }

      throw new Error("Usage: state print | state conflicts");
    }

    if (cmd === "workspace") {
      const action = sub;
      if (!action || (action !== "list" && action !== "ls" && action !== "show"))
        throw new Error("Usage: workspace list | workspace show [--workspace-id <id>]");

      const repoPath = requireRepoPath(globals);
      const { state } = await rebuildState(repoPath);

      if (action === "list" || action === "ls") {
        const workspaces = Object.values(state.workspaces);
        if (globals.output === "json") {
          printJson({ defaultWorkspaceId: state.defaultWorkspaceId, workspaces });
          return 0;
        }
        if (workspaces.length === 0) {
          process.stdout.write("No workspaces.\n");
          return 0;
        }
        for (const ws of workspaces) {
          const marker = ws.id === state.defaultWorkspaceId ? " *" : "";
          process.stdout.write(`- ${ws.name} (${ws.id}) boards=${ws.boardIds.length}${marker}\n`);
        }
        return 0;
      }

      const workspaceId = readFlag(argv, "--workspace-id") ?? state.defaultWorkspaceId;
      const ws = state.workspaces[workspaceId];
      if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);

      if (globals.output === "json") {
        printJson({ workspace: ws });
        return 0;
      }
      process.stdout.write(`${ws.name} (${ws.id}) boards=${ws.boardIds.length}\n`);
      for (const bId of ws.boardIds) {
        const b = state.boards[bId];
        if (b) process.stdout.write(`- ${b.name} (${b.id}) lists=${b.listIds.length}\n`);
      }
      return 0;
    }

    if (cmd === "board") {
      const repoPath = requireRepoPath(globals);
      if (sub === "list" || sub === "ls") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (globals.output === "json") {
          printJson({ boards: boards.map((b) => ({ id: b.id, name: b.name, listIds: b.listIds })) });
          return 0;
        }
        if (boards.length === 0) {
          process.stdout.write("No boards.\n");
          return 0;
        }
        for (const b of boards) process.stdout.write(`- ${b.name} (${b.id})\n`);
        return 0;
      }
      if (sub === "show") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const includeArchived = argv.includes("--include-archived");
        const { state } = await rebuildState(repoPath);
        const board = state.boards[boardId];
        if (!board) throw new Error(`Board not found: ${boardId}`);

        const lists = listList(state, board);
        const listSummaries = lists.map((l) => {
          const visibleCardIds = includeArchived
            ? l.cardIds
            : l.cardIds.filter((id) => !state.cards[id]?.archived);
          return { id: l.id, name: l.name, position: l.position, cardCount: visibleCardIds.length };
        });

        if (globals.output === "json") {
          printJson({
            board: { id: board.id, name: board.name, workspaceId: board.workspaceId },
            includeArchived,
            lists: listSummaries,
          });
          return 0;
        }

        process.stdout.write(`${board.name} (${board.id}) lists=${lists.length}\n`);
        for (const l of listSummaries) {
          process.stdout.write(`- ${l.name} (${l.id}) cards=${l.cardCount} pos=${l.position}\n`);
        }
        return 0;
      }

      if (sub !== "create") throw new Error("Usage: board list|show|create ...");
      const name = readRequiredFlag(argv, "--name");
      const workspaceId = readFlag(argv, "--workspace-id");
      const boardId = await createBoard({
        repoPath,
        name,
        workspaceId,
        actorId: globals.actorId,
        git,
      });
      if (globals.output === "json") printJson({ boardId });
      else process.stdout.write(`${boardId}\n`);
      return 0;
    }

    if (cmd === "list") {
      const repoPath = requireRepoPath(globals);
      if (sub === "list" || sub === "ls") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const { state } = await rebuildState(repoPath);
        const board = state.boards[boardId];
        if (!board) throw new Error(`Board not found: ${boardId}`);
        const lists = listList(state, board);
        if (globals.output === "json") {
          printJson({
            boardId,
            lists: lists.map((l) => ({
              id: l.id,
              name: l.name,
              position: l.position,
              cardIds: l.cardIds,
            })),
          });
          return 0;
        }
        if (lists.length === 0) {
          process.stdout.write("No lists.\n");
          return 0;
        }
        for (const l of lists) {
          process.stdout.write(`- ${l.name} (${l.id}) cards=${l.cardIds.length} pos=${l.position}\n`);
        }
        return 0;
      }
      if (sub === "show") {
        const listId = readRequiredFlag(argv, "--list-id");
        const includeArchived = argv.includes("--include-archived");
        const { state } = await rebuildState(repoPath);
        const list = state.lists[listId];
        if (!list) throw new Error(`List not found: ${listId}`);

        const cards = list.cardIds
          .map((id) => state.cards[id])
          .filter(Boolean)
          .filter((c) => (includeArchived ? true : !c.archived));

        if (globals.output === "json") {
          printJson({
            list: { id: list.id, boardId: list.boardId, name: list.name, position: list.position },
            includeArchived,
            cards: cards.map((c) => ({
              id: c.id,
              title: c.title,
              archived: c.archived,
              dueDate: c.dueDate,
              labels: c.labels ?? [],
            })),
          });
          return 0;
        }

        process.stdout.write(
          `${list.name} (${list.id}) board=${list.boardId} cards=${cards.length} pos=${list.position}\n`,
        );
        for (const c of cards) {
          const archived = c.archived ? " [archived]" : "";
          const labels = c.labels?.length ? ` [${c.labels.join(", ")}]` : "";
          const due = c.dueDate ? ` due=${c.dueDate}` : "";
          process.stdout.write(`- ${c.title} (${c.id})${archived}${labels}${due}\n`);
        }
        return 0;
      }
      if (sub === "create") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const name = readRequiredFlag(argv, "--name");
        const listId = await createList({
          repoPath,
          boardId,
          name,
          actorId: globals.actorId,
          git,
        });
        if (globals.output === "json") printJson({ listId });
        else process.stdout.write(`${listId}\n`);
        return 0;
      }
      if (sub === "move") {
        const listId = readRequiredFlag(argv, "--list-id");
        const positionRaw = readRequiredFlag(argv, "--position");
        const position = Number.parseInt(positionRaw, 10);
        if (!Number.isFinite(position)) throw new Error(`Invalid --position: ${positionRaw}`);
        await moveList({ repoPath, listId, position, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      throw new Error("Usage: list list|show|create|move ...");
    }

    if (cmd === "card") {
      const repoPath = requireRepoPath(globals);
      if (sub === "list" || sub === "ls") {
        const includeArchived = argv.includes("--include-archived");
        const boardId = readFlag(argv, "--board-id");
        const listId = readFlag(argv, "--list-id");

        const { state } = await rebuildState(repoPath);

        let cards =
          listId && state.lists[listId]
            ? state.lists[listId]!.cardIds.map((id) => state.cards[id]).filter(Boolean)
            : [];

        if (!listId) {
          if (!boardId) throw new Error("Usage: card list (--board-id <id> | --list-id <id>)");
          const board = state.boards[boardId];
          if (!board) throw new Error(`Board not found: ${boardId}`);
          cards = cardsForBoard(state, board);
        }

        if (!includeArchived) cards = cards.filter((c) => !c.archived);

        if (globals.output === "json") {
          const inferredBoardId = boardId ?? (listId ? state.lists[listId]?.boardId : undefined);
          printJson({
            boardId: inferredBoardId,
            listId: listId ?? null,
            includeArchived,
            cards: cards.map((c) => ({
              id: c.id,
              boardId: c.boardId,
              listId: c.listId,
              title: c.title,
              description: c.description,
              labels: c.labels ?? [],
              dueDate: c.dueDate ?? null,
              archived: !!c.archived,
            })),
          });
          return 0;
        }

        if (cards.length === 0) {
          process.stdout.write("No cards.\n");
          return 0;
        }
        for (const c of cards) {
          const archived = c.archived ? " [archived]" : "";
          const labels = c.labels?.length ? ` [${c.labels.join(", ")}]` : "";
          const due = c.dueDate ? ` due=${c.dueDate}` : "";
          process.stdout.write(`- ${c.title} (${c.id}) list=${c.listId}${archived}${labels}${due}\n`);
        }
        return 0;
      }
      if (sub === "show") {
        const cardId = readRequiredFlag(argv, "--card-id");
        const includeComments = argv.includes("--include-comments");
        const { state } = await rebuildState(repoPath);
        const card = state.cards[cardId];
        if (!card) throw new Error(`Card not found: ${cardId}`);

        const checklist = card.checklist ?? [];
        const commentsAll = state.commentsByCardId[cardId] ?? [];
        const comments = includeComments ? commentsAll : [];

        if (globals.output === "json") {
          printJson({
            card: {
              id: card.id,
              boardId: card.boardId,
              listId: card.listId,
              title: card.title,
              description: card.description,
              dueDate: card.dueDate,
              labels: card.labels ?? [],
              archived: !!card.archived,
              checklist,
              commentCount: commentsAll.length,
              comments: includeComments ? comments : undefined,
            },
          });
          return 0;
        }

        const archived = card.archived ? " [archived]" : "";
        const labels = card.labels?.length ? ` [${card.labels.join(", ")}]` : "";
        const due = card.dueDate ? ` due=${card.dueDate}` : "";
        process.stdout.write(`${card.title}${archived}${labels}${due} (${card.id})\n`);
        if (card.description) process.stdout.write(`desc: ${card.description}\n`);
        if (checklist.length) {
          process.stdout.write("checklist:\n");
          for (const it of checklist) {
            process.stdout.write(`- ${it.checked ? "[x]" : "[ ]"} ${it.text} (${it.id})\n`);
          }
        }
        if (!includeComments) process.stdout.write(`comments: ${commentsAll.length} (use --include-comments)\n`);
        else {
          process.stdout.write("comments:\n");
          for (const c of comments) {
            process.stdout.write(`- ${c.ts} ${c.actorId}: ${c.text} (${c.id})\n`);
          }
        }
        return 0;
      }
      if (sub === "create") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const listId = readRequiredFlag(argv, "--list-id");
        const title = readRequiredFlag(argv, "--title");
        const cardId = await createCard({
          repoPath,
          boardId,
          listId,
          title,
          actorId: globals.actorId,
          git,
        });
        if (globals.output === "json") printJson({ cardId });
        else process.stdout.write(`${cardId}\n`);
        return 0;
      }
      if (sub === "update") {
        const cardId = readRequiredFlag(argv, "--card-id");
        const title = readFlag(argv, "--title");
        const description = readFlag(argv, "--description");
        const dueDate = readFlag(argv, "--due-date");
        const clearDue = argv.includes("--clear-due-date");
        const labelsRaw = readFlag(argv, "--labels");
        const labels = labelsRaw
          ? labelsRaw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        await updateCard({
          repoPath,
          cardId,
          actorId: globals.actorId,
          title,
          description,
          dueDate: clearDue ? null : dueDate,
          labels,
          git,
        });
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (sub === "move") {
        const cardId = readRequiredFlag(argv, "--card-id");
        const toListId = readRequiredFlag(argv, "--to-list-id");
        await moveCard({ repoPath, cardId, toListId, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (sub === "archive" || sub === "unarchive") {
        const cardId = readRequiredFlag(argv, "--card-id");
        const archived = sub === "archive";
        await archiveCard({ repoPath, cardId, archived, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ ok: true, archived });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (sub === "comment") {
        const action = pos[2];
        if (action !== "add") throw new Error("Usage: card comment add --card-id <id> --text <text>");
        const cardId = readRequiredFlag(argv, "--card-id");
        const text = readRequiredFlag(argv, "--text");
        const commentId = await addComment({ repoPath, cardId, text, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ commentId });
        else process.stdout.write(`${commentId}\n`);
        return 0;
      }
      if (sub === "checklist") {
        const action = pos[2];
        const cardId = readRequiredFlag(argv, "--card-id");
        if (action === "add") {
          const text = readRequiredFlag(argv, "--text");
          const itemId = await addChecklistItem({
            repoPath,
            cardId,
            text,
            actorId: globals.actorId,
            git,
          });
          if (globals.output === "json") printJson({ itemId });
          else process.stdout.write(`${itemId}\n`);
          return 0;
        }
        if (action === "toggle") {
          const itemId = readRequiredFlag(argv, "--item-id");
          const checkedRaw = readRequiredFlag(argv, "--checked");
          const checked =
            checkedRaw === "true" ? true : checkedRaw === "false" ? false : undefined;
          if (typeof checked !== "boolean")
            throw new Error(`Invalid --checked: ${checkedRaw} (expected true|false)`);
          await toggleChecklistItem({ repoPath, cardId, itemId, checked, actorId: globals.actorId, git });
          if (globals.output === "json") printJson({ ok: true });
          else process.stdout.write("OK\n");
          return 0;
        }
        if (action === "rename") {
          const itemId = readRequiredFlag(argv, "--item-id");
          const text = readRequiredFlag(argv, "--text");
          await renameChecklistItem({ repoPath, cardId, itemId, text, actorId: globals.actorId, git });
          if (globals.output === "json") printJson({ ok: true });
          else process.stdout.write("OK\n");
          return 0;
        }
        if (action === "remove") {
          const itemId = readRequiredFlag(argv, "--item-id");
          await removeChecklistItem({ repoPath, cardId, itemId, actorId: globals.actorId, git });
          if (globals.output === "json") printJson({ ok: true });
          else process.stdout.write("OK\n");
          return 0;
        }
        throw new Error("Usage: card checklist add|toggle|rename|remove ...");
      }

      throw new Error("Usage: card create|update|move|archive|unarchive|comment|checklist ...");
    }

    if (cmd === "member") {
      const repoPath = requireRepoPath(globals);
      if (sub === "list" || sub === "ls") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const { state } = await rebuildState(repoPath);
        if (!state.boards[boardId]) throw new Error(`Board not found: ${boardId}`);
        const memberships = state.memberships[boardId] ?? {};
        const entries = Object.entries(memberships).sort((a, b) => a[0].localeCompare(b[0]));
        if (globals.output === "json") {
          printJson({ boardId, members: entries.map(([actorId, role]) => ({ actorId, role })) });
          return 0;
        }
        if (entries.length === 0) {
          process.stdout.write("No members.\n");
          return 0;
        }
        for (const [actorId, role] of entries) process.stdout.write(`- ${actorId} role=${role}\n`);
        return 0;
      }
      if (sub === "add") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const memberId = readRequiredFlag(argv, "--member-id");
        const role = roleFromString(readRequiredFlag(argv, "--role"));
        await addMember({ repoPath, boardId, memberId, role, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (sub === "role") {
        const boardId = readRequiredFlag(argv, "--board-id");
        const memberId = readRequiredFlag(argv, "--member-id");
        const role = roleFromString(readRequiredFlag(argv, "--role"));
        await changeMemberRole({ repoPath, boardId, memberId, role, actorId: globals.actorId, git });
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      throw new Error("Usage: member list|add|role ...");
    }

    if (cmd === "search") {
      if (sub !== "cards") throw new Error("Usage: search cards <query> [--json]");
      const repoPath = requireRepoPath(globals);
      const query = pos.slice(2).join(" ").trim();
      if (!query) throw new Error("Missing search query.");
      const results = await searchCards(repoPath, query);
      if (globals.output === "json") printJson({ results });
      else {
        if (results.length === 0) {
          process.stdout.write("No matches.\n");
          return 0;
        }
        for (const r of results) process.stdout.write(`- ${r.title} (${r.cardId})\n`);
      }
      return 0;
    }

    if (cmd === "git") {
      const action = sub;
      const repoPath = requireRepoPath(globals);
      if (action === "status") {
        const status = await git.status?.(repoPath);
        if (globals.output === "json") printJson({ status: status ?? null });
        else {
          if (!status) process.stdout.write("git: unavailable\n");
          else {
            process.stdout.write("Git status:\n");
            if (status.branch) process.stdout.write(`- branch: ${status.branch}\n`);
            if (typeof status.ahead === "number") process.stdout.write(`- ahead: ${status.ahead}\n`);
            if (typeof status.behind === "number") process.stdout.write(`- behind: ${status.behind}\n`);
            process.stdout.write(`- dirty: ${status.dirty ? "yes" : "no"}\n`);
          }
        }
        return status?.dirty ? 1 : 0;
      }
      if (action === "fetch") {
        if (!git.fetch) throw new Error("git: unavailable");
        await git.fetch(repoPath);
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (action === "pull") {
        if (!git.pull) throw new Error("git: unavailable");
        await git.pull(repoPath);
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (action === "push") {
        if (!git.push) throw new Error("git: unavailable");
        await git.push(repoPath);
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      if (action === "sync") {
        if (git.sync) await git.sync(repoPath);
        else {
          if (!git.fetch || !git.pull || !git.push) throw new Error("git: unavailable");
          await git.fetch(repoPath);
          await git.pull(repoPath);
          await git.push(repoPath);
        }
        if (globals.output === "json") printJson({ ok: true });
        else process.stdout.write("OK\n");
        return 0;
      }
      throw new Error("Usage: git status|fetch|pull|push|sync");
    }

    throw new Error(`Unknown command: ${cmd} (use --help)`);
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    const isUsage =
      message.startsWith("Usage:") ||
      message.startsWith("Missing required flag:") ||
      message.startsWith("Missing --repo") ||
      message.startsWith("Missing command.");
    const exitCode = isUsage ? 2 : 1;
    if (globals.output === "json") printJson({ error: { message, code: exitCode } });
    else process.stderr.write(`${message}\n`);
    return exitCode;
  }
}
