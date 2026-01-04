const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sdk = require("../dist/index.js");

test("searchCards finds by title (case-insensitive, tokenized)", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-search-"));
  try {
    await sdk.initRepo({ path: tmpRoot });

    const actorId = "actor@test";
    const boardId = await sdk.createBoard({ repoPath: tmpRoot, name: "B", actorId });
    const listId = await sdk.createList({ repoPath: tmpRoot, boardId, name: "L", actorId });

    const c1 = await sdk.createCard({
      repoPath: tmpRoot,
      boardId,
      listId,
      title: "Fix login bug",
      actorId,
    });
    await sdk.createCard({ repoPath: tmpRoot, boardId, listId, title: "Write docs", actorId });

    const results = await sdk.searchCards(tmpRoot, "LOGIN fix");
    assert.deepEqual(
      results.map((r) => r.cardId),
      [c1],
    );
    assert.equal(results[0].boardId, boardId);
    assert.equal(results[0].listId, listId);
    assert.equal(results[0].title, "Fix login bug");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
