const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { resolveRepoPath } = require("../dist/repoPath.js");
const { createKanbanRepoClient } = require("../dist/kanbanRepo.js");

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-vscode-"));
}

test("vscode-extension: resolveRepoPath prefers config then workspace", () => {
  assert.equal(resolveRepoPath({ configuredRepoPath: "  /x  ", workspaceFolders: ["/w"] }), "/x");
  assert.equal(
    resolveRepoPath({ configuredRepoPath: "", workspaceFolders: ["/w1", "/w2"] }),
    "/w1",
  );
  assert.equal(resolveRepoPath({ configuredRepoPath: "", workspaceFolders: [] }), undefined);
});

test("vscode-extension: SDK integration creates and queries entities", async () => {
  const repo = mkTmpDir();
  const actorId = "actor-1";
  const client = createKanbanRepoClient(repo);

  await client.ensureInitialized();

  const boardId = await client.createBoard("Board A", actorId);
  await client.renameBoard(boardId, "Board Renamed", actorId);
  const listId = await client.createList(boardId, "Todo", actorId);
  await client.renameList(listId, "Todo Renamed", actorId);
  await client.moveList(listId, 500, actorId);
  const cardId = await client.createCard(boardId, listId, "Task 1", actorId);

  await client.updateCard(
    cardId,
    { description: "Hello", dueDate: "2026-01-01T00:00:00.000Z", labels: ["a", "b"] },
    actorId,
  );

  const itemId = await client.addChecklistItem(cardId, "One", actorId);
  await client.toggleChecklistItem(cardId, itemId, true, actorId);
  await client.renameChecklistItem(cardId, itemId, "One!", actorId);

  await client.addComment(cardId, "Nice", actorId);

  await client.archiveCard(cardId, true, actorId);
  await client.archiveCard(cardId, false, actorId);

  const state = await client.loadState();
  assert.equal(Object.keys(state.boards).length, 1);
  assert.equal(Object.keys(state.lists).length, 1);
  assert.equal(Object.keys(state.cards).length, 1);
  assert.equal(state.boards[boardId].name, "Board Renamed");
  assert.equal(state.lists[listId].name, "Todo Renamed");

  const card = state.cards[cardId];
  assert.ok(card);
  assert.equal(card.title, "Task 1");
  assert.equal(card.description, "Hello");
  assert.equal(card.dueDate, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(card.labels, ["a", "b"]);
  assert.equal(card.archived, false);
  assert.equal(card.checklist.length, 1);
  assert.equal(card.checklist[0].checked, true);
  assert.equal(card.checklist[0].text, "One!");
  assert.ok(Array.isArray(state.commentsByCardId[cardId]));
  assert.equal(state.commentsByCardId[cardId].length, 1);
  assert.equal(state.commentsByCardId[cardId][0].text, "Nice");

  const results = await client.searchCards("hello a");
  assert.equal(results.length, 1);
  assert.equal(results[0].cardId, cardId);

  const history = await client.getCardHistory(cardId);
  assert.ok(history.length >= 6);
  assert.equal(history[0].type, "card.created");

  await client.removeChecklistItem(cardId, itemId, actorId);
  const state2 = await client.loadState();
  assert.equal(state2.cards[cardId].checklist.length, 0);
});

test("vscode-extension: SDK integration moves cards within and across lists", async () => {
  const repo = mkTmpDir();
  const actorId = "actor-1";
  const client = createKanbanRepoClient(repo);
  await client.ensureInitialized();

  const boardId = await client.createBoard("Board A", actorId);
  const a = await client.createList(boardId, "A", actorId);
  const b = await client.createList(boardId, "B", actorId);

  const c1 = await client.createCard(boardId, a, "C1", actorId);
  const c2 = await client.createCard(boardId, a, "C2", actorId);

  // move within list A to a lower position
  await client.moveCard(c1, a, 2500, actorId);
  // move to list B
  await client.moveCard(c2, b, 1500, actorId);

  const state = await client.loadState();
  assert.equal(state.cards[c1].listId, a);
  assert.equal(state.cards[c2].listId, b);
});
