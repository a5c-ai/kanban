import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

function runCapture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${cmd} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout}`.trim();
}

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const extensionDir = resolve(repoRoot, "apps", "vscode-extension");
const sdkDir = resolve(repoRoot, "packages", "sdk");

const pkg = JSON.parse(
  runCapture("node", ["-p", "JSON.stringify(require('./package.json'))"], { cwd: extensionDir }),
);
const version = pkg.version;
const defaultOut = resolve(repoRoot, "dist", `kanban-vscode-extension-${version}.vsix`);

let outPath = defaultOut;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--out") {
    outPath = resolve(repoRoot, process.argv[i + 1] ?? "");
    i++;
    continue;
  }
  if (arg === "-o") {
    outPath = resolve(repoRoot, process.argv[i + 1] ?? "");
    i++;
    continue;
  }
}

mkdirSync(resolve(repoRoot, "dist"), { recursive: true });

run(npmBin, ["run", "build", "-w", sdkDir]);
run(npmBin, ["run", "build", "-w", extensionDir]);

const tmpBase = mkdtempSync(join(tmpdir(), "kanban-vsce-pack-"));
const tmpExt = join(tmpBase, "vscode-extension");
mkdirSync(tmpExt, { recursive: true });

cpSync(extensionDir, tmpExt, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(extensionDir.length).replaceAll("\\", "/");
    if (rel.startsWith("/node_modules/") || rel === "/node_modules") return false;
    return true;
  },
});

const tgzName = runCapture(npmBin, ["pack", "-w", sdkDir, "--silent"], { cwd: repoRoot });
const tgzSrc = resolve(repoRoot, tgzName);
const tgzDst = resolve(tmpBase, basename(tgzName));
cpSync(tgzSrc, tgzDst);
rmSync(tgzSrc, { force: true });

run(npmBin, ["install", "--omit=dev", "--no-save", tgzDst], { cwd: tmpExt });

const vsceBin = resolve(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);

if (!existsSync(vsceBin)) {
  throw new Error(`vsce binary not found at ${vsceBin}. Run \`npm install\` first.`);
}

run(vsceBin, ["package", "-o", outPath, "--allow-missing-repository", "--skip-license"], {
  cwd: tmpExt,
});

rmSync(tmpBase, { recursive: true, force: true });

console.log(outPath);
