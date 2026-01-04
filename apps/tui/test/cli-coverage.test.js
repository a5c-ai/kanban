const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, ["apps/tui/dist/index.js", ...args], {
    encoding: "utf-8",
    ...opts,
  });
  return {
    code: res.status ?? 0,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function mkTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-cli-"));
  return dir;
}

test("cli: help includes expected commands", () => {
  const { code, stdout } = run(["--help"]);
  assert.equal(code, 0);
  const expected = [
    "repo init",
    "state print | state conflicts",
    "workspace list | workspace show",
    "board list",
    "board show",
    "board create",
    "list list",
    "list show",
    "list create",
    "list move",
    "card list",
    "card show",
    "card create",
    "card update",
    "card move",
    "card archive|unarchive",
    "card comment add",
    "card checklist add",
    "card checklist toggle",
    "card checklist rename",
    "card checklist remove",
    "member list",
    "member add",
    "member role",
    "search cards",
    "git status|fetch|pull|push|sync",
  ];
  for (const line of expected) assert.ok(stdout.includes(line), `missing from help: ${line}`);
});

test("cli: basic read/list/show commands work (human + json)", () => {
  const repo = mkTmpDir();

  {
    const res = run(["--repo", repo, "repo", "init"]);
    assert.equal(res.code, 0, res.stderr);
  }

  const boardId = run(["--repo", repo, "board", "create", "--name", "Board A"]).stdout.trim();
  assert.ok(boardId.length > 0);
  const listId = run(["--repo", repo, "list", "create", "--board-id", boardId, "--name", "Todo"]).stdout.trim();
  assert.ok(listId.length > 0);
  const cardId = run([
    "--repo",
    repo,
    "card",
    "create",
    "--board-id",
    boardId,
    "--list-id",
    listId,
    "--title",
    "Task 1",
  ]).stdout.trim();
  assert.ok(cardId.length > 0);

  // board list/show
  {
    const res = run(["--repo", repo, "board", "list"]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Board A"));
  }
  {
    const res = run(["--repo", repo, "board", "show", "--board-id", boardId]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Board A"));
    assert.ok(res.stdout.includes("Todo"));
  }

  // list list/show
  {
    const res = run(["--repo", repo, "list", "list", "--board-id", boardId]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Todo"));
  }
  {
    const res = run(["--repo", repo, "list", "show", "--list-id", listId]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Todo"));
    assert.ok(res.stdout.includes("Task 1"));
  }

  // card list/show
  {
    const res = run(["--repo", repo, "card", "list", "--board-id", boardId]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Task 1"));
  }
  {
    const res = run(["--repo", repo, "card", "show", "--card-id", cardId]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes("Task 1"));
  }

  // workspace list/show (json)
  {
    const res = run(["--repo", repo, "--json", "workspace", "list"]);
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.ok(typeof parsed.defaultWorkspaceId === "string");
    assert.ok(Array.isArray(parsed.workspaces));
  }
  {
    const res = run(["--repo", repo, "--json", "workspace", "show"]);
    assert.equal(res.code, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.workspace);
    assert.ok(typeof parsed.workspace.id === "string");
  }

  // member list should not crash
  {
    const res = run(["--repo", repo, "member", "list", "--board-id", boardId]);
    assert.equal(res.code, 0, res.stderr);
  }
});

test("cli: usage errors return exit code 2", () => {
  const repo = mkTmpDir();
  run(["--repo", repo, "repo", "init"]);

  {
    const res = run(["--repo", repo, "board"]);
    assert.equal(res.code, 2);
  }
  {
    const res = run(["--repo", repo, "list", "create"]);
    assert.equal(res.code, 2);
  }
});
