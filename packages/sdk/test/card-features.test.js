const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sdk = require("../dist/index.js");

test("card fields: update/labels/due/archived/comments/checklist", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-card-"));
  try {
    await sdk.initRepo({ path: tmpRoot });

    const actorId = "actor@test";
    const boardId = await sdk.createBoard({ repoPath: tmpRoot, name: "B", actorId });
    const listId = await sdk.createList({ repoPath: tmpRoot, boardId, name: "Todo", actorId });
    const list2Id = await sdk.createList({ repoPath: tmpRoot, boardId, name: "Done", actorId });

    const cardId = await sdk.createCard({
      repoPath: tmpRoot,
      boardId,
      listId,
      title: "T",
      actorId,
    });

    await sdk.updateCard({
      repoPath: tmpRoot,
      cardId,
      actorId,
      title: "Title",
      description: "Desc",
      dueDate: "2030-01-02T03:04:05.000Z",
      labels: ["bug", "p1"],
    });

    const commentId = await sdk.addComment({ repoPath: tmpRoot, cardId, text: "hello", actorId });
    assert.ok(commentId);

    const itemId = await sdk.addChecklistItem({
      repoPath: tmpRoot,
      cardId,
      text: "do it",
      actorId,
    });
    assert.ok(itemId);
    await sdk.toggleChecklistItem({ repoPath: tmpRoot, cardId, itemId, checked: true, actorId });
    await sdk.renameChecklistItem({
      repoPath: tmpRoot,
      cardId,
      itemId,
      text: "do it now",
      actorId,
    });

    await sdk.archiveCard({ repoPath: tmpRoot, cardId, archived: true, actorId });

    const { state } = await sdk.rebuildState(tmpRoot);
    const card = state.cards[cardId];
    assert.equal(card.title, "Title");
    assert.equal(card.description, "Desc");
    assert.equal(card.dueDate, "2030-01-02T03:04:05.000Z");
    assert.deepEqual(card.labels, ["bug", "p1"]);
    assert.equal(card.archived, true);
    assert.equal(card.checklist.length, 1);
    assert.equal(card.checklist[0].id, itemId);
    assert.equal(card.checklist[0].text, "do it now");
    assert.equal(card.checklist[0].checked, true);

    assert.ok(state.commentsByCardId[cardId]);
    assert.equal(state.commentsByCardId[cardId].length, 1);
    assert.equal(state.commentsByCardId[cardId][0].text, "hello");

    await sdk.removeChecklistItem({ repoPath: tmpRoot, cardId, itemId, actorId });
    const after = await sdk.rebuildState(tmpRoot);
    assert.equal(after.state.cards[cardId].checklist.length, 0);

    // list reorder
    await sdk.moveList({ repoPath: tmpRoot, listId: list2Id, position: 500, actorId });
    const afterListMove = await sdk.rebuildState(tmpRoot);
    assert.deepEqual(afterListMove.state.boards[boardId].listIds, [list2Id, listId]);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("conflict surfacing: same seq writes different values", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-conflict-"));
  try {
    await sdk.initRepo({ path: tmpRoot });
    const actorId = "actor@test";
    const boardId = await sdk.createBoard({ repoPath: tmpRoot, name: "B", actorId });
    const listId = await sdk.createList({ repoPath: tmpRoot, boardId, name: "L", actorId });
    const cardId = await sdk.createCard({
      repoPath: tmpRoot,
      boardId,
      listId,
      title: "T",
      actorId,
    });

    const opsDir = path.join(tmpRoot, ".kanban", "ops");
    const seq = 4;
    const mk = (opId, title, actor) => ({
      schemaVersion: 1,
      opId,
      seq,
      type: "card.updated",
      ts: new Date().toISOString(),
      actorId: actor,
      payload: { cardId, title },
    });

    const f1 = path.join(opsDir, `${String(seq).padStart(16, "0")}-a.json`);
    const f2 = path.join(opsDir, `${String(seq).padStart(16, "0")}-b.json`);
    await fs.writeFile(f1, JSON.stringify(mk("a", "One", "a@test"), null, 2) + "\n", "utf8");
    await fs.writeFile(f2, JSON.stringify(mk("b", "Two", "b@test"), null, 2) + "\n", "utf8");

    const { state } = await sdk.rebuildState(tmpRoot);
    assert.ok(state.conflicts.length >= 1);
    const c = state.conflicts.find(
      (x) => x.entityType === "card" && x.entityId === cardId && x.field === "title",
    );
    assert.ok(c);
    assert.equal(c.seq, seq);
    assert.equal(c.ops.length, 2);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
