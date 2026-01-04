const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sdk = require("../../../packages/sdk/dist/index.js");
const web = require("../dist/app.js");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Expected TCP address");
  return { baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function postJson(baseUrl, url, body) {
  const res = await fetch(baseUrl + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { res, json };
}

async function getJson(baseUrl, url) {
  const res = await fetch(baseUrl + url);
  const json = await res.json();
  return { res, json };
}

test("web API: boards/lists/cards + move + search + history", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-web-"));
  const actorId = "web-test@local";

  const server = web.createWebServer({ repoPath: tmpRoot, port: 0, actorId });
  try {
    await sdk.initRepo({ path: tmpRoot });

    const { baseUrl } = await listen(server);

    const b = await postJson(baseUrl, "/api/boards", { name: "Board" });
    assert.equal(b.res.status, 200);
    assert.ok(b.json.ok);
    assert.ok(b.json.boardId);

    const l1 = await postJson(baseUrl, "/api/lists", { boardId: b.json.boardId, name: "Todo" });
    assert.equal(l1.res.status, 200);
    assert.ok(l1.json.listId);

    const l2 = await postJson(baseUrl, "/api/lists", { boardId: b.json.boardId, name: "Done" });
    assert.equal(l2.res.status, 200);
    assert.ok(l2.json.listId);

    const lm = await postJson(baseUrl, "/api/lists/move", {
      listId: l2.json.listId,
      position: 500,
    });
    assert.equal(lm.res.status, 200);
    assert.ok(lm.json.ok);

    const c = await postJson(baseUrl, "/api/cards", {
      boardId: b.json.boardId,
      listId: l1.json.listId,
      title: "Fix login bug",
    });
    assert.equal(c.res.status, 200);
    assert.ok(c.json.cardId);

    const u = await postJson(baseUrl, "/api/cards/update", {
      cardId: c.json.cardId,
      title: "Fix login bug (now)",
      description: "Details",
      dueDate: "2030-01-02T03:04:05.000Z",
      labels: ["bug", "p1"],
    });
    assert.equal(u.res.status, 200);
    assert.ok(u.json.ok);

    const com = await postJson(baseUrl, "/api/cards/comments", {
      cardId: c.json.cardId,
      text: "hello",
    });
    assert.equal(com.res.status, 200);
    assert.ok(com.json.commentId);

    const it = await postJson(baseUrl, "/api/cards/checklist/add", {
      cardId: c.json.cardId,
      text: "do it",
    });
    assert.equal(it.res.status, 200);
    assert.ok(it.json.itemId);

    const tog = await postJson(baseUrl, "/api/cards/checklist/toggle", {
      cardId: c.json.cardId,
      itemId: it.json.itemId,
      checked: true,
    });
    assert.equal(tog.res.status, 200);
    assert.ok(tog.json.ok);

    const m = await postJson(baseUrl, "/api/cards/move", {
      cardId: c.json.cardId,
      toListId: l2.json.listId,
    });
    assert.equal(m.res.status, 200);
    assert.ok(m.json.ok);

    const s = await getJson(baseUrl, "/api/search?query=login");
    assert.equal(s.res.status, 200);
    assert.ok(s.json.ok);
    assert.equal(s.json.results.length, 1);
    assert.equal(s.json.results[0].cardId, c.json.cardId);

    const ar = await postJson(baseUrl, "/api/cards/archive", {
      cardId: c.json.cardId,
      archived: true,
    });
    assert.equal(ar.res.status, 200);
    assert.ok(ar.json.ok);

    const rs = await postJson(baseUrl, "/api/cards/archive", {
      cardId: c.json.cardId,
      archived: false,
    });
    assert.equal(rs.res.status, 200);
    assert.ok(rs.json.ok);

    const h = await getJson(
      baseUrl,
      `/api/cards/history?cardId=${encodeURIComponent(c.json.cardId)}`,
    );
    assert.equal(h.res.status, 200);
    assert.ok(h.json.ok);
    assert.ok(h.json.items.length >= 2);
    assert.equal(h.json.items[0].actorId, actorId);

    const st = await getJson(baseUrl, "/api/state");
    assert.equal(st.res.status, 200);
    assert.ok(st.json.ok);
    assert.ok(st.json.appliedThroughSeq >= 1);
    assert.equal(st.json.state.boards[b.json.boardId].listIds[0], l2.json.listId);
    assert.equal(st.json.state.cards[c.json.cardId].title, "Fix login bug (now)");
    assert.equal(st.json.state.cards[c.json.cardId].description, "Details");
    assert.equal(st.json.state.cards[c.json.cardId].dueDate, "2030-01-02T03:04:05.000Z");
    assert.deepEqual(st.json.state.cards[c.json.cardId].labels, ["bug", "p1"]);
    assert.equal(st.json.state.cards[c.json.cardId].archived, false);
    assert.equal(st.json.state.cards[c.json.cardId].listId, l2.json.listId);
    assert.ok(st.json.state.lists[l2.json.listId].cardIds.includes(c.json.cardId));
    assert.ok(st.json.state.commentsByCardId[c.json.cardId]);
    assert.equal(st.json.state.commentsByCardId[c.json.cardId].length, 1);
    assert.equal(st.json.state.cards[c.json.cardId].checklist.length, 1);
    assert.equal(st.json.state.cards[c.json.cardId].checklist[0].checked, true);

    const gs = await getJson(baseUrl, "/api/git/status");
    assert.equal(gs.res.status, 200);
    assert.ok(gs.json.ok);
    assert.ok(typeof gs.json.status.dirty === "boolean");
  } finally {
    server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
