import path from "node:path";
import process from "node:process";
import readline from "node:readline";
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
  moveList,
  moveCard,
  removeChecklistItem,
  rebuildState,
  renameChecklistItem,
  searchCards,
  toggleChecklistItem,
  updateCard,
  type Card,
  type MemberRole,
} from "@trello-clone/sdk";
import { boardList, cardsForBoard, listList, printState } from "./state-print";

function parseRepoArg(argv: string[]): { repoPath: string } {
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

  throw new Error("Usage: npm run tui -- --repo <path>");
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function cardLabel(c: Card): string {
  const archived = c.archived ? "[archived] " : "";
  return `${archived}${c.title}`;
}

function parseLabels(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRole(raw: string): MemberRole | undefined {
  const x = raw.trim().toLowerCase();
  if (x === "v" || x === "viewer") return "viewer";
  if (x === "e" || x === "editor") return "editor";
  return undefined;
}

const MEMBER_ROLES_HELP = "viewer|editor";

async function chooseByIdOrNumber<T extends { id: string }>(
  rl: readline.Interface,
  title: string,
  items: T[],
  label: (item: T) => string,
): Promise<T | undefined> {
  if (items.length === 0) return undefined;

  process.stdout.write(`\n${title}\n`);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    process.stdout.write(`  ${i + 1}) ${label(item)} (${item.id})\n`);
  }

  const raw = await prompt(rl, "Choose by number (or paste an id, blank to cancel): ");
  if (!raw) return undefined;

  const asNum = Number.parseInt(raw, 10);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= items.length) return items[asNum - 1];

  const match = items.find((it) => it.id === raw);
  if (match) return match;

  process.stdout.write("Invalid selection.\n");
  return undefined;
}

export async function runTui(argv: string[]): Promise<void> {
  const { repoPath } = parseRepoArg(argv);
  const actorId = process.env.KANBAN_ACTOR_ID ?? "tui@local";
  const git = await createCliGitAdapter();

  await initRepo({ path: repoPath, git });

  process.stdout.write(`tui: repo=${repoPath} actorId=${actorId}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const cmd = (
        await prompt(
          rl,
          "\n[l]ist  [b]oard+  [l+]list+  [n]members  [r]eorder  [c]ard+  [m]ove  [e]dit  [a]rchive  [k]checklist  [o]comment  [s]earch  [x]conflicts  [g]it  [q]uit > ",
        )
      ).toLowerCase();

      if (cmd === "q" || cmd === "quit") return;

      if (cmd === "l" || cmd === "list") {
        const { state } = await rebuildState(repoPath);
        printState(state);
        continue;
      }

      if (cmd === "b" || cmd === "board") {
        const name = await prompt(rl, "Board name: ");
        if (!name) continue;
        const boardId = await createBoard({ repoPath, name, actorId, git });
        process.stdout.write(`Created board: ${boardId}\n`);
        continue;
      }

      if (cmd === "l+" || cmd === "list+") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (boards.length === 0) {
          process.stdout.write("No boards.\n");
          continue;
        }
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;
        const name = await prompt(rl, "List name: ");
        if (!name) continue;
        const listId = await createList({ repoPath, boardId: board.id, name, actorId, git });
        process.stdout.write(`Created list: ${listId}\n`);
        continue;
      }

      if (cmd === "n" || cmd === "members" || cmd === "member") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (boards.length === 0) {
          process.stdout.write("No boards.\n");
          continue;
        }
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        let membersState = state;
        let boardName = board.name;

        const refreshMembersState = async (): Promise<boolean> => {
          const { state: fresh } = await rebuildState(repoPath);
          const latestBoard = fresh.boards[board.id];
          if (!latestBoard) {
            process.stdout.write("Board no longer exists.\n");
            return false;
          }
          membersState = fresh;
          boardName = latestBoard.name;
          return true;
        };

        while (true) {
          const memberships = membersState.memberships[board.id] ?? {};
          const entries = Object.entries(memberships).sort((a, b) => a[0].localeCompare(b[0]));

          process.stdout.write(`\nMembers (board: ${boardName})\n`);
          if (entries.length === 0) process.stdout.write("  (no members)\n");
          else {
            for (const [memberId, role] of entries) {
              process.stdout.write(`  - ${memberId} role=${role}\n`);
            }
          }

          const action = (
            await prompt(rl, "Members: [a]dd  [r]ole  [enter]refresh  [b]ack > ")
          )
            .toLowerCase()
            .trim();

          if (!action) {
            const ok = await refreshMembersState();
            if (!ok) break;
            continue;
          }
          if (action === "b" || action === "back") break;

          if (action === "a" || action === "add") {
            const memberId = await prompt(rl, "Member memberId: ");
            if (!memberId) {
              process.stdout.write("Aborted (empty memberId).\n");
              continue;
            }
            const roleRaw = await prompt(
              rl,
              `Role (${MEMBER_ROLES_HELP}) [v/e] (default viewer): `,
            );
            const role = roleRaw ? parseRole(roleRaw) : "viewer";
            if (!role) {
              process.stdout.write(`Invalid role (allowed: ${MEMBER_ROLES_HELP}).\n`);
              continue;
            }
            try {
              await addMember({ repoPath, boardId: board.id, memberId, role, actorId, git });
              process.stdout.write(`Added member: ${memberId} role=${role}\n`);
              const ok = await refreshMembersState();
              if (!ok) break;
            } catch (err) {
              process.stdout.write(`Failed to add member: ${(err as Error).message}\n`);
            }
            continue;
          }

          if (action === "r" || action === "role") {
            if (entries.length === 0) {
              process.stdout.write("No members to update.\n");
              continue;
            }
            const member = await chooseByIdOrNumber(
              rl,
              `Members (board: ${boardName})`,
              entries.map(([id, role]) => ({ id, role })),
              (m) => `${m.id} role=${m.role}`,
            );
            if (!member) continue;

            const roleRaw = await prompt(
              rl,
              `New role for ${member.id} (${MEMBER_ROLES_HELP}) [v/e]: `,
            );
            const role = parseRole(roleRaw);
            if (!role) {
              process.stdout.write(`Invalid role (allowed: ${MEMBER_ROLES_HELP}).\n`);
              continue;
            }

            try {
              await changeMemberRole({
                repoPath,
                boardId: board.id,
                memberId: member.id,
                role,
                actorId,
                git,
              });
              process.stdout.write(`Updated member: ${member.id} role=${role}\n`);
              const ok = await refreshMembersState();
              if (!ok) break;
            } catch (err) {
              process.stdout.write(`Failed to update role: ${(err as Error).message}\n`);
            }
            continue;
          }

          process.stdout.write("Unknown members command.\n");
        }
        continue;
      }

      if (cmd === "r" || cmd === "reorder") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (boards.length === 0) {
          process.stdout.write("No boards.\n");
          continue;
        }
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const lists = listList(state, board);
        if (lists.length < 2) {
          process.stdout.write("Need at least 2 lists to reorder.\n");
          continue;
        }
        const list = await chooseByIdOrNumber(
          rl,
          `Lists (board: ${board.name})`,
          lists,
          (l) => l.name,
        );
        if (!list) continue;

        const currentIndex = lists.findIndex((l) => l.id === list.id);
        const rawPos = await prompt(
          rl,
          `New position (1-${lists.length}, current ${currentIndex + 1}): `,
        );
        if (!rawPos) continue;
        const newPos = Number.parseInt(rawPos, 10);
        if (!Number.isFinite(newPos) || newPos < 1 || newPos > lists.length) {
          process.stdout.write("Invalid position.\n");
          continue;
        }
        if (newPos === currentIndex + 1) {
          process.stdout.write("No change.\n");
          continue;
        }

        const ids = board.listIds.filter((id) => id !== list.id);
        const insertIndex = newPos - 1;
        const prevId = insertIndex > 0 ? ids[insertIndex - 1] : null;
        const nextId = insertIndex < ids.length ? ids[insertIndex] : null;

        const prevPos = prevId ? (state.lists[prevId]?.position ?? 0) : null;
        const nextPos = nextId ? (state.lists[nextId]?.position ?? 0) : null;

        let position: number | null = null;
        if (prevPos !== null && nextPos !== null) position = (prevPos + nextPos) / 2;
        else if (prevPos !== null) position = prevPos + 1000;
        else if (nextPos !== null) position = nextPos - 1000;

        if (position === null) {
          process.stdout.write("Unable to compute new position.\n");
          continue;
        }

        await moveList({ repoPath, listId: list.id, position, actorId, git });
        process.stdout.write(`Reordered list: ${list.id} -> ${newPos}\n`);
        continue;
      }

      if (cmd === "c" || cmd === "create") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (boards.length === 0) {
          process.stdout.write("No boards. Create one via 'board'.\n");
          continue;
        }
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;
        const lists = listList(state, board);
        if (lists.length === 0) {
          process.stdout.write("No lists. Create one via 'list+'.\n");
          continue;
        }
        const list = await chooseByIdOrNumber(
          rl,
          `Lists (board: ${board.name})`,
          lists,
          (l) => l.name,
        );
        if (!list) continue;

        const title = await prompt(rl, "Card title: ");
        if (!title) {
          process.stdout.write("Aborted (empty title).\n");
          continue;
        }

        const cardId = await createCard({
          repoPath,
          boardId: board.id,
          listId: list.id,
          title,
          actorId,
          git,
        });
        process.stdout.write(`Created card: ${cardId}\n`);
        continue;
      }

      if (cmd === "m" || cmd === "move") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        if (boards.length === 0) {
          process.stdout.write("No boards.\n");
          continue;
        }
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const cards = cardsForBoard(state, board);
        if (cards.length === 0) {
          process.stdout.write("No cards.\n");
          continue;
        }
        const card = await chooseByIdOrNumber(rl, `Cards (board: ${board.name})`, cards, cardLabel);
        if (!card) continue;

        const lists = listList(state, board);
        const toList = await chooseByIdOrNumber(
          rl,
          `Move to list (card: ${card.title})`,
          lists,
          (l) => l.name,
        );
        if (!toList) continue;

        await moveCard({ repoPath, cardId: card.id, toListId: toList.id, actorId, git });
        process.stdout.write(`Moved card: ${card.id} -> ${toList.id}\n`);
        continue;
      }

      if (cmd === "e" || cmd === "edit") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const cards = cardsForBoard(state, board);
        const card = await chooseByIdOrNumber(rl, `Cards (board: ${board.name})`, cards, cardLabel);
        if (!card) continue;

        const which = (
          await prompt(rl, "Edit: [t]itle [d]escription [u]dueDate [g]labels > ")
        ).toLowerCase();

        if (which === "t") {
          const title = await prompt(rl, "New title: ");
          if (!title) continue;
          await updateCard({ repoPath, cardId: card.id, title, actorId, git });
          process.stdout.write("Updated title.\n");
          continue;
        }
        if (which === "d") {
          const description = await prompt(rl, "New description: ");
          await updateCard({ repoPath, cardId: card.id, description, actorId, git });
          process.stdout.write("Updated description.\n");
          continue;
        }
        if (which === "u") {
          const dueRaw = await prompt(rl, "New dueDate (ISO or blank to clear): ");
          const dueDate = dueRaw ? dueRaw : null;
          await updateCard({ repoPath, cardId: card.id, dueDate, actorId, git });
          process.stdout.write("Updated due date.\n");
          continue;
        }
        if (which === "g") {
          const raw = await prompt(rl, "Labels (comma): ");
          const labels = parseLabels(raw);
          await updateCard({ repoPath, cardId: card.id, labels, actorId, git });
          process.stdout.write("Updated labels.\n");
          continue;
        }

        process.stdout.write("Unknown field.\n");
        continue;
      }

      if (cmd === "a" || cmd === "archive") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const cards = cardsForBoard(state, board);
        const card = await chooseByIdOrNumber(rl, `Cards (board: ${board.name})`, cards, cardLabel);
        if (!card) continue;

        await archiveCard({ repoPath, cardId: card.id, archived: !card.archived, actorId, git });
        process.stdout.write(card.archived ? "Restored card.\n" : "Archived card.\n");
        continue;
      }

      if (cmd === "k" || cmd === "checklist") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const cards = cardsForBoard(state, board);
        const card = await chooseByIdOrNumber(rl, `Cards (board: ${board.name})`, cards, cardLabel);
        if (!card) continue;

        const next = (await prompt(rl, "Checklist: [a]dd [t]oggle [r]ename [x]remove > "))
          .toLowerCase()
          .trim();

        const latest = (await rebuildState(repoPath)).state.cards[card.id];
        const items = latest?.checklist ?? [];
        if (next !== "a" && items.length === 0) {
          process.stdout.write("No checklist items.\n");
          continue;
        }

        if (next === "a") {
          const text = await prompt(rl, "Item text: ");
          if (!text) continue;
          const itemId = await addChecklistItem({ repoPath, cardId: card.id, text, actorId, git });
          process.stdout.write(`Added checklist item: ${itemId}\n`);
          continue;
        }

        const item = await chooseByIdOrNumber(
          rl,
          `Checklist items (card: ${card.title})`,
          items.map((it) => ({
            id: it.id,
            label: `${it.checked ? "[x]" : "[ ]"} ${it.text}`,
          })),
          (x) => x.label,
        );
        if (!item) continue;

        if (next === "t") {
          const current = items.find((it) => it.id === item.id);
          await toggleChecklistItem({
            repoPath,
            cardId: card.id,
            itemId: item.id,
            checked: !current?.checked,
            actorId,
            git,
          });
          process.stdout.write("Toggled.\n");
          continue;
        }
        if (next === "r") {
          const text = await prompt(rl, "New text: ");
          if (!text) continue;
          await renameChecklistItem({
            repoPath,
            cardId: card.id,
            itemId: item.id,
            text,
            actorId,
            git,
          });
          process.stdout.write("Renamed.\n");
          continue;
        }
        if (next === "x") {
          await removeChecklistItem({ repoPath, cardId: card.id, itemId: item.id, actorId, git });
          process.stdout.write("Removed.\n");
          continue;
        }

        process.stdout.write("Unknown checklist command.\n");
        continue;
      }

      if (cmd === "o" || cmd === "comment") {
        const { state } = await rebuildState(repoPath);
        const boards = boardList(state);
        const board = await chooseByIdOrNumber(rl, "Boards", boards, (b) => b.name);
        if (!board) continue;

        const cards = cardsForBoard(state, board);
        const card = await chooseByIdOrNumber(rl, `Cards (board: ${board.name})`, cards, cardLabel);
        if (!card) continue;

        const text = await prompt(rl, "Comment: ");
        if (!text) continue;
        const commentId = await addComment({ repoPath, cardId: card.id, text, actorId, git });
        process.stdout.write(`Added comment: ${commentId}\n`);
        continue;
      }

      if (cmd === "s" || cmd === "search") {
        const query = await prompt(rl, "Search query: ");
        const results = await searchCards(repoPath, query);
        if (results.length === 0) {
          process.stdout.write("No matches.\n");
          continue;
        }
        process.stdout.write("\nMatches:\n");
        for (const r of results.slice(0, 20)) {
          process.stdout.write(`- ${r.title} (${r.cardId})\n`);
        }
        continue;
      }

      if (cmd === "x" || cmd === "conflicts") {
        const { state } = await rebuildState(repoPath);
        if (!state.conflicts.length) {
          process.stdout.write("No conflicts.\n");
          continue;
        }
        process.stdout.write("\nConflicts:\n");
        for (const c of state.conflicts.slice(0, 50)) {
          process.stdout.write(`- seq=${c.seq} ${c.entityType}:${c.entityId} field=${c.field}\n`);
          for (const o of c.ops) {
            process.stdout.write(`    * ${o.ts} ${o.actorId} opId=${o.opId}\n`);
          }
        }
        continue;
      }

      if (cmd === "g" || cmd === "git") {
        const status = await (git.status
          ? git.status(repoPath)
          : Promise.resolve({
              branch: undefined,
              ahead: undefined,
              behind: undefined,
              dirty: false,
              porcelain: "",
            }));
        process.stdout.write("\nGit status:\n");
        if (status.branch) process.stdout.write(`- branch: ${status.branch}\n`);
        if (typeof status.ahead === "number") process.stdout.write(`- ahead: ${status.ahead}\n`);
        if (typeof status.behind === "number") process.stdout.write(`- behind: ${status.behind}\n`);
        process.stdout.write(`- dirty: ${status.dirty ? "yes" : "no"}\n`);

        const action = (await prompt(rl, "Git: [f]etch [p]ull [u]push [y]sync [enter]skip > "))
          .toLowerCase()
          .trim();
        if (!action) continue;
        if (action === "f" && git.fetch) await git.fetch(repoPath);
        else if (action === "p" && git.pull) await git.pull(repoPath);
        else if (action === "u" && git.push) await git.push(repoPath);
        else if (action === "y") {
          if (git.sync) await git.sync(repoPath);
          else {
            if (git.fetch) await git.fetch(repoPath);
            if (git.pull) await git.pull(repoPath);
            if (git.push) await git.push(repoPath);
          }
        } else {
          process.stdout.write("Unknown git action.\n");
          continue;
        }

        const after = await (git.status
          ? git.status(repoPath)
          : Promise.resolve({
              branch: undefined,
              ahead: undefined,
              behind: undefined,
              dirty: false,
              porcelain: "",
            }));
        process.stdout.write(`Done. dirty=${after.dirty ? "yes" : "no"}\n`);
        continue;
      }

      process.stdout.write("Unknown command.\n");
    }
  } finally {
    rl.close();
  }
}
