const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sdk = require("../dist/index.js");

test("RBAC: viewer cannot mutate; editor can", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-rbac-"));
  try {
    await sdk.initRepo({ path: tmpRoot });

    const alice = "alice@test";
    const bob = "bob@test";

    const boardId = await sdk.createBoard({ repoPath: tmpRoot, name: "B", actorId: alice });
    const todoListId = await sdk.createList({
      repoPath: tmpRoot,
      boardId,
      name: "To Do",
      actorId: alice,
    });
    const doneListId = await sdk.createList({
      repoPath: tmpRoot,
      boardId,
      name: "Done",
      actorId: alice,
    });
    const cardId = await sdk.createCard({
      repoPath: tmpRoot,
      boardId,
      listId: todoListId,
      title: "C",
      actorId: alice,
    });

    await sdk.addMember({
      repoPath: tmpRoot,
      boardId,
      memberId: bob,
      role: "viewer",
      actorId: alice,
    });

    await assert.rejects(
      () => sdk.moveCard({ repoPath: tmpRoot, cardId, toListId: doneListId, actorId: bob }),
      /Permission denied/,
    );

    await sdk.changeMemberRole({
      repoPath: tmpRoot,
      boardId,
      memberId: bob,
      role: "editor",
      actorId: alice,
    });
    await sdk.moveCard({ repoPath: tmpRoot, cardId, toListId: doneListId, actorId: bob });

    const { state } = await sdk.rebuildState(tmpRoot);
    assert.equal(state.cards[cardId].listId, doneListId);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
