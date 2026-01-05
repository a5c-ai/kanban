const test = require("node:test");
const assert = require("node:assert/strict");

const { createBoardViewMessageHandler } = require("../dist/webview/boardProtocol.js");

test("vscode-extension: board protocol returns opResult with safeToRetry on mutation error", async () => {
  /** @type {any[]} */
  const posted = [];
  const handler = createBoardViewMessageHandler({
    getClientOrThrow: () => ({
      client: {
        ensureInitialized: async () => {},
        updateCard: async () => {
          throw new Error("conflict: concurrent update");
        },
      },
      repoPath: "/repo",
    }),
    getActorId: async () => "actor-1",
    loadState: async () => {
      throw new Error("not used");
    },
    onDidMutate: () => {},
    postMessage: (msg) => posted.push(msg),
    executeCommand: async () => {},
  });

  await handler({
    type: "updateCard",
    cardId: "c1",
    patch: { title: "x" },
    requestId: "r1",
  });

  assert.deepEqual(posted, [
    {
      type: "opResult",
      requestId: "r1",
      ok: false,
      operation: "updateCard",
      safeToRetry: true,
      error: "conflict: concurrent update",
    },
  ]);
});

test("vscode-extension: board protocol responds with searchResults and opResult", async () => {
  /** @type {any[]} */
  const posted = [];
  const handler = createBoardViewMessageHandler({
    getClientOrThrow: () => ({
      client: {
        ensureInitialized: async () => {},
        searchCards: async () => [{ cardId: "c1", boardId: "b1", listId: "l1", title: "Hello" }],
      },
      repoPath: "/repo",
    }),
    getActorId: async () => "actor-1",
    loadState: async () => {
      throw new Error("not used");
    },
    onDidMutate: () => {},
    postMessage: (msg) => posted.push(msg),
    executeCommand: async () => {},
  });

  await handler({ type: "searchCards", query: "hello", requestId: "r2" });

  assert.deepEqual(posted, [
    {
      type: "searchResults",
      query: "hello",
      results: [{ cardId: "c1", boardId: "b1", listId: "l1", title: "Hello" }],
    },
    {
      type: "opResult",
      requestId: "r2",
      ok: true,
      operation: "searchCards",
    },
  ]);
});
