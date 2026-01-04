const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sdk = require("../dist/index.js");

test("listOpsSince returns ops after cursor", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-ops-"));
  try {
    await sdk.initRepo({ path: tmpRoot });

    const actorId = "actor@test";
    const boardId = await sdk.createBoard({ repoPath: tmpRoot, name: "B", actorId });
    const listId = await sdk.createList({ repoPath: tmpRoot, boardId, name: "L", actorId });
    await sdk.createCard({ repoPath: tmpRoot, boardId, listId, title: "C1", actorId });

    const all = await sdk.loadOps(tmpRoot);
    assert.ok(all.length >= 3);

    const cursor = all[1].seq;
    const tail = await sdk.listOpsSince(tmpRoot, cursor);
    assert.ok(tail.length >= 1);
    for (const op of tail) assert.ok(op.seq > cursor);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
