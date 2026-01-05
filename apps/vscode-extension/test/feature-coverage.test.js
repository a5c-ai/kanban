const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("vscode-extension: feature coverage gate passes", () => {
  const res = spawnSync(
    process.execPath,
    ["apps/vscode-extension/scripts/check-feature-coverage.mjs"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(res.status ?? 0, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /Feature coverage:/);
});
