const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRootNode, getChildren } = require("../dist/treeModel.js");

test("vscode-extension: tree model orders board/list/card children", () => {
  const state = {
    schemaVersion: 1,
    defaultWorkspaceId: "w",
    workspaces: { w: { id: "w", name: "Default", boardIds: ["b1", "b2"] } },
    boards: {
      b2: { id: "b2", workspaceId: "w", name: "B Board", listIds: ["l2"] },
      b1: { id: "b1", workspaceId: "w", name: "A Board", listIds: ["l1"] },
    },
    lists: {
      l1: { id: "l1", boardId: "b1", name: "Todo", position: 2000, cardIds: ["c2", "c1"] },
      l2: { id: "l2", boardId: "b2", name: "Doing", position: 1000, cardIds: [] },
    },
    cards: {
      c1: {
        id: "c1",
        boardId: "b1",
        listId: "l1",
        title: "First",
        description: "",
        dueDate: null,
        labels: [],
        archived: false,
        position: 1000,
        checklist: [],
      },
      c2: {
        id: "c2",
        boardId: "b1",
        listId: "l1",
        title: "Second",
        description: "",
        dueDate: null,
        labels: [],
        archived: true,
        position: 2000,
        checklist: [],
      },
    },
    memberships: {},
    commentsByCardId: {},
    conflicts: [],
  };

  const root = buildRootNode();
  const boards = getChildren(state, root);
  assert.equal(boards[0].label, "A Board");
  assert.equal(boards[1].label, "B Board");

  const lists = getChildren(state, boards[0]);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].label, "Todo");

  const cards = getChildren(state, lists[0]);
  assert.equal(cards.map((c) => c.label).join(","), "First,Second");
  assert.equal(cards[1].description, "archived");
});
