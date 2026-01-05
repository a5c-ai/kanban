import http from "node:http";
import path from "node:path";
import {
  addChecklistItem,
  addComment,
  addMember,
  archiveCard,
  changeMemberRole,
  createBoard,
  createCard,
  createList,
  initRepo,
  loadOps,
  moveCard,
  moveList,
  rebuildState,
  searchCards,
  subscribeOps,
  toggleChecklistItem,
  renameChecklistItem,
  removeChecklistItem,
  updateCard,
  type AnyOp,
  type BoardId,
  type CardId,
  type ListId,
} from "@a5c-ai/kanban-sdk";
import type { GitAdapter } from "@a5c-ai/kanban-sdk";

export interface WebArgs {
  repoPath: string;
  port: number;
  actorId: string;
  git?: GitAdapter;
}

export function parseArgs(argv: string[]): { repoPath: string; port: number } {
  const repoFlagIdx = argv.indexOf("--repo");
  const repoValue = repoFlagIdx !== -1 ? argv[repoFlagIdx + 1] : undefined;
  const repoEquals = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length);
  const repo = repoValue ?? repoEquals ?? argv.find((a) => !a.startsWith("-"));
  if (!repo) throw new Error("Usage: npm run web -- --repo <path> --port 3000");

  const portFlagIdx = argv.indexOf("--port");
  const portValue = portFlagIdx !== -1 ? argv[portFlagIdx + 1] : undefined;
  const portEqualsRaw = argv.find((a) => a.startsWith("--port="))?.slice("--port=".length);
  const portRaw = portValue ?? portEqualsRaw ?? "3000";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid --port: ${portRaw}`);

  return { repoPath: path.resolve(repo), port };
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload).toString());
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(html).toString());
  res.end(html);
}

function sendText(
  res: http.ServerResponse,
  statusCode: number,
  contentType: string,
  text: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", contentType);
  res.setHeader("content-length", Buffer.byteLength(text).toString());
  res.end(text);
}

function readBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > maxBytes) {
        req.destroy(new Error(`Body too large (>${maxBytes} bytes)`));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderPage(args: { repoPath: string; actorId: string; bootstrapJson: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Git Native Kanban Board</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="appRoot">
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-title">Git Native Kanban Board</div>
          <div class="brand-meta">repo: <code>${escapeHtml(args.repoPath)}</code> - actorId: <code>${escapeHtml(args.actorId)}</code></div>
        </div>
	        <div class="controls">
	          <select id="boardSelect" class="select" title="Board"></select>
	          <button id="newBoardBtn" class="button primary">New board</button>
	          <button id="membersBtn" class="button">Members</button>
	          <button id="archivedToggleBtn" class="button" aria-pressed="false" title="Show/hide archived cards">Archived: Off</button>
	          <div class="search-wrap">
	            <input id="searchInput" class="input" placeholder="Search cards..." autocomplete="off" aria-controls="searchResults" aria-expanded="false" />
	            <div id="searchResults" class="search-results" role="listbox" aria-label="Search results"></div>
	          </div>
	          <button id="refreshBtn" class="button">Refresh</button>
          <button id="gitSyncBtn" class="button primary" title="fetch + pull --ff-only + push">Sync</button>
        </div>
      </div>
    </div>
    <div class="wrap">
      <div id="status" class="status"></div>
      <div id="statusLive" class="sr-only" aria-live="polite" aria-atomic="true"></div>
      <div id="main"></div>
    </div>
		    <div id="drawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" aria-hidden="true" tabindex="-1">
		      <div class="drawer-header">
		        <div id="drawerTitle" class="drawer-title">Card</div>
		        <div class="drawer-actions">
		          <button id="drawerArchive" type="button" class="button">Archive</button>
		          <button id="drawerClose" type="button" class="button" aria-label="Close card">Close</button>
		        </div>
		      </div>
	      <div class="drawer-body">
        <div id="drawerErr" class="error"></div>
        <div class="kv">
          <div class="k">Card</div>
          <div id="drawerCardId" class="v muted"></div>
        </div>
        <div class="kv">
          <div class="k">Title</div>
          <input id="drawerTitleInput" class="input" placeholder="Title" />
        </div>
        <div class="kv">
          <div class="k">List</div>
          <div id="drawerList" class="v"></div>
        </div>
        <div class="kv">
          <div class="k">Move to</div>
          <select id="drawerMoveTo" class="select"></select>
        </div>
        <div class="kv">
          <div class="k">Due date (ISO)</div>
          <input id="drawerDue" class="input" placeholder="YYYY-MM-DDTHH:MM:SSZ or blank" />
        </div>
        <div class="kv">
          <div class="k">Labels (comma)</div>
          <input id="drawerLabels" class="input" placeholder="bug, p1, ..." />
        </div>
        <div class="kv">
          <div class="k">Description</div>
          <textarea id="drawerDescription" class="textarea" rows="5" placeholder="Markdown (basic)"></textarea>
          <button id="drawerSave" class="button primary">Save</button>
          <div class="k" style="margin-top: 10px;">Preview</div>
          <div id="drawerDescriptionPreview" class="md"></div>
        </div>
        <div class="kv">
          <div class="k">Checklist</div>
          <div id="drawerChecklist" class="checklist"></div>
          <div class="composer-row">
            <input id="drawerChecklistNew" class="input" placeholder="Add checklist item..." />
            <button id="drawerChecklistAdd" class="button primary">Add</button>
          </div>
        </div>
        <div class="kv">
          <div class="k">Comments</div>
          <div id="drawerComments" class="comments"></div>
          <textarea id="drawerCommentNew" class="textarea" rows="3" placeholder="Write a comment..."></textarea>
          <button id="drawerCommentAdd" class="button primary">Comment</button>
        </div>
	        <div class="kv">
	          <div class="k">History</div>
	          <div id="drawerHistory" class="history"></div>
	        </div>
		      </div>
		    </div>
      </div>
		    <div id="modalOverlay" class="modal-overlay" aria-hidden="true" hidden>
		      <div id="modalDialog" class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalErr" tabindex="-1">
		        <div class="modal-header">
		          <div id="modalTitle" class="modal-title">Dialog</div>
		          <button id="modalClose" type="button" class="button" aria-label="Close dialog">✕</button>
		        </div>
            <div id="modalDesc" class="sr-only"></div>
		        <div id="modalBody" class="modal-body"></div>
		        <div id="modalErr" class="error modal-error" aria-live="polite"></div>
		        <div id="modalFooter" class="modal-footer"></div>
		      </div>
		    </div>
	    <script>
	      window.__KANBAN_BOOTSTRAP__ = ${args.bootstrapJson};
	    </script>
	    <script src="/app.js"></script>
	  </body>
</html>`;
}

function renderAppCss(): string {
  return [
    ":root {",
    "  --bg: #0b1220;",
    "  --panel: #0f1a2e;",
    "  --text: #e8eefc;",
    "  --muted: #a7b4d3;",
    "  --border: rgba(255,255,255,0.09);",
    "  --shadow: rgba(0,0,0,0.35);",
    "  --accent: #7aa2ff;",
    "  --danger: #ff6b6b;",
    "  --ok: #2dd4bf;",
    "}",
    "* { box-sizing: border-box; }",
    "body {",
    "  margin: 0;",
    "  min-height: 100vh;",
    "  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;",
    "  color: var(--text);",
    "  background: radial-gradient(1200px 600px at 15% 10%, rgba(122,162,255,0.22), transparent 45%),",
    "    radial-gradient(900px 500px at 85% 30%, rgba(45,212,191,0.15), transparent 55%),",
    "    var(--bg);",
    "}",
    "code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 6px; }",
    ".topbar { position: sticky; top: 0; z-index: 2; backdrop-filter: blur(10px); background: rgba(11,18,32,0.78); border-bottom: 1px solid var(--border); }",
    ".topbar-inner { max-width: 1200px; margin: 0 auto; padding: 14px 16px; display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; }",
    ".brand { display: flex; flex-direction: column; gap: 2px; }",
    ".brand-title { font-size: 14px; font-weight: 650; }",
    ".brand-meta { font-size: 12px; color: var(--muted); }",
    ".controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }",
    ".select, .input, .button { border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.04); color: var(--text); padding: 8px 10px; font-size: 13px; outline: none; }",
    ".textarea { border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.04); color: var(--text); padding: 8px 10px; font-size: 13px; outline: none; width: 100%; resize: vertical; }",
    ".select { padding-right: 28px; }",
    ".button { cursor: pointer; user-select: none; }",
	    ".button.primary { background: rgba(122,162,255,0.16); border-color: rgba(122,162,255,0.35); }",
	    ".button:focus, .select:focus, .input:focus { border-color: rgba(122,162,255,0.6); box-shadow: 0 0 0 3px rgba(122,162,255,0.15); }",
	    ".textarea:focus { border-color: rgba(122,162,255,0.6); box-shadow: 0 0 0 3px rgba(122,162,255,0.15); }",
	    ".sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }",
	    ".wrap { max-width: 1200px; margin: 0 auto; padding: 16px; }",
    ".status { margin-top: 10px; font-size: 13px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }",
    ".status .pill { display: inline-flex; gap: 8px; align-items: center; border: 1px solid var(--border); background: rgba(255,255,255,0.03); border-radius: 999px; padding: 6px 10px; }",
    ".status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }",
    ".status .dot.ok { background: var(--ok); }",
    ".status .dot.bad { background: var(--danger); }",
    ".board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }",
    ".list { flex: 0 0 280px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 14px; padding: 10px; box-shadow: 0 10px 24px var(--shadow); }",
    ".list-header { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 10px; }",
    ".list-title { font-weight: 650; font-size: 13px; margin: 0; }",
    ".list-sub { font-size: 12px; color: var(--muted); }",
	    ".cards { display: grid; gap: 8px; min-height: 10px; }",
	    ".card { border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: linear-gradient(180deg, rgba(15,34,63,0.95), rgba(13,30,54,0.95)); padding: 10px; cursor: pointer; transition: transform 0.08s ease, border-color 0.12s ease; display: grid; gap: 6px; }",
	    ".card:hover { transform: translateY(-1px); border-color: rgba(122,162,255,0.4); }",
	    ".card.archived { opacity: 0.58; border-style: dashed; filter: saturate(0.7); }",
	    ".card.archived:hover { transform: none; border-color: rgba(255,255,255,0.14); }",
	    ".card-title { font-size: 13px; margin: 0; line-height: 1.25; }",
	    ".card-labels { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 2px; }",
	    ".card-meta { font-size: 11px; color: var(--muted); margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
	    ".badge { font-size: 11px; line-height: 1; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: var(--muted); }",
	    ".badge.archived { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.02); }",
	    ".badge.ok { border-color: rgba(45,212,191,0.45); background: rgba(45,212,191,0.12); color: var(--text); }",
	    ".badge.due { border-color: rgba(122,162,255,0.35); background: rgba(122,162,255,0.10); color: var(--text); }",
	    ".badge.due.overdue { border-color: rgba(255,107,107,0.55); background: rgba(255,107,107,0.16); color: #ffecec; }",
	    ".chip { font-size: 11px; line-height: 1; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: var(--text); display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
	    ".chip.label { border-color: hsl(var(--h) 70% 60% / 0.40); background: hsl(var(--h) 70% 55% / 0.16); }",
	    ".chip.more { color: var(--muted); }",
	    ".drop-target { outline: 2px dashed rgba(122,162,255,0.5); outline-offset: 2px; }",
    ".composer { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 10px; }",
    ".composer-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }",
    ".empty { border: 1px solid var(--border); background: rgba(255,255,255,0.03); border-radius: 14px; padding: 18px; }",
    ".empty h2 { margin: 0 0 8px; font-size: 16px; }",
    ".empty p { margin: 0 0 10px; color: var(--muted); }",
    ".drawer { position: fixed; top: 0; right: 0; width: min(420px, 92vw); height: 100vh; background: rgba(15,26,46,0.96); border-left: 1px solid var(--border); box-shadow: -20px 0 40px rgba(0,0,0,0.4); transform: translateX(110%); transition: transform 0.15s ease; z-index: 5; display: flex; flex-direction: column; }",
    ".drawer.open { transform: translateX(0%); }",
    ".drawer-header { padding: 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: 10px; align-items: center; }",
    ".drawer-actions { display: inline-flex; gap: 8px; align-items: center; }",
    ".drawer-title { font-size: 14px; font-weight: 650; }",
    ".drawer-body { padding: 14px; overflow: auto; display: grid; gap: 10px; }",
    ".kv { display: grid; gap: 6px; }",
    ".kv .k { font-size: 12px; color: var(--muted); }",
    ".kv .v { font-size: 13px; }",
    ".history { display: grid; gap: 6px; }",
    ".history-item { border: 1px solid var(--border); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.03); }",
    ".history-item .when { font-size: 11px; color: var(--muted); }",
    ".history-item .what { font-size: 13px; margin-top: 4px; }",
    ".checklist { display: grid; gap: 8px; }",
    ".checklist-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: start; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 8px; background: rgba(255,255,255,0.02); }",
    ".checklist-item input[type='checkbox'] { margin-top: 3px; }",
    ".checklist-item .text { font-size: 13px; line-height: 1.25; }",
    ".checklist-item .text.done { text-decoration: line-through; color: var(--muted); }",
    ".comments { display: grid; gap: 8px; }",
    ".comment { border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.02); }",
    ".comment .meta { font-size: 11px; color: var(--muted); }",
    ".comment .body { font-size: 13px; margin-top: 6px; white-space: pre-wrap; }",
    ".md { border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.02); }",
    ".md h1, .md h2, .md h3 { margin: 10px 0 6px; }",
    ".md p { margin: 6px 0; }",
    ".md code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 6px; }",
    ".muted { color: var(--muted); }",
    ".error { color: var(--danger); white-space: pre-wrap; }",
    ".search-wrap { position: relative; }",
	    ".search-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: rgba(15,26,46,0.98); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 18px 40px rgba(0,0,0,0.4); overflow: auto; max-height: min(60vh, 520px); display: none; z-index: 10; }",
	    ".search-results.open { display: block; }",
	    ".search-results .item { padding: 10px; cursor: pointer; border-top: 1px solid rgba(255,255,255,0.06); }",
	    ".search-results .item:first-child { border-top: none; }",
	    ".search-results .item:hover { background: rgba(122,162,255,0.10); }",
	    ".search-results .item.active { background: rgba(122,162,255,0.16); box-shadow: inset 0 0 0 1px rgba(122,162,255,0.28); }",
	    ".search-results .item .t { font-size: 13px; }",
	    ".search-results .item .m { font-size: 11px; color: var(--muted); margin-top: 4px; }",
	    ".modal-open { overflow: hidden; }",
	    ".modal-overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,0.55); z-index: 50; opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }",
	    ".modal-overlay.open { opacity: 1; pointer-events: auto; }",
	    ".modal { width: min(640px, 92vw); max-height: min(78vh, 640px); overflow: auto; border-radius: 16px; border: 1px solid var(--border); background: rgba(15,26,46,0.96); box-shadow: 0 22px 60px rgba(0,0,0,0.55); transform: translateY(8px) scale(0.99); transition: transform 0.12s ease; }",
	    ".modal-overlay.open .modal { transform: translateY(0px) scale(1); }",
	    ".modal-header { padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; gap: 10px; align-items: center; position: sticky; top: 0; background: rgba(15,26,46,0.96); backdrop-filter: blur(8px); }",
	    ".modal-title { font-size: 14px; font-weight: 650; }",
	    "#modalClose { width: 34px; height: 34px; padding: 0; display: inline-grid; place-items: center; border-radius: 10px; line-height: 1; }",
	    ".modal-body { padding: 14px; display: grid; gap: 12px; }",
	    ".modal-error { padding: 0 14px 12px; }",
	    ".modal-footer { padding: 14px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 10px; justify-content: flex-end; align-items: center; position: sticky; bottom: 0; background: rgba(15,26,46,0.96); }",
	    ".form-row { display: grid; gap: 6px; }",
	    ".help { font-size: 12px; color: var(--muted); }",
	    ".inline-error { font-size: 12px; color: var(--danger); }",
	    ".members-list { display: grid; gap: 8px; }",
	    ".member-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.02); }",
	    ".member-row .id { font-size: 13px; overflow: hidden; text-overflow: ellipsis; }",
	    ".member-row .meta { font-size: 11px; color: var(--muted); margin-top: 4px; }",
	    ".member-row [data-member-status] { font-size: 11px; margin-top: 4px; }",
	    ".member-row [data-member-error] { margin-top: 4px; }",
	    ".member-row.saving { opacity: 0.7; }",
	    ".two-col { display: grid; grid-template-columns: 1fr 180px; gap: 10px; }",
	    "@media (max-width: 520px) { .two-col { grid-template-columns: 1fr; } .modal { max-height: 84vh; } }",
	    "@media (max-width: 760px) { .topbar-inner { grid-template-columns: 1fr; } .controls { justify-content: flex-start; } }",
	    "@media (prefers-reduced-motion: reduce) { .modal-overlay, .modal { transition: none !important; } }",
	    "",
	  ].join("\n");
	}

function renderAppJs(): string {
  return [
    `"use strict";`,
    "",
    "const bootstrap = window.__KANBAN_BOOTSTRAP__ || { state: null, appliedThroughSeq: 0 };",
    "const elMain = document.getElementById('main');",
		    "const elStatus = document.getElementById('status');",
		    "const elStatusLive = document.getElementById('statusLive');",
		    "const elTopbar = document.querySelector('.topbar');",
		    "const elWrap = document.querySelector('.wrap');",
		    "const elBoardSelect = document.getElementById('boardSelect');",
		    "const elRefresh = document.getElementById('refreshBtn');",
		    "const elGitSync = document.getElementById('gitSyncBtn');",
		    "const elNewBoard = document.getElementById('newBoardBtn');",
		    "const elMembers = document.getElementById('membersBtn');",
	    "const elArchivedToggle = document.getElementById('archivedToggleBtn');",
	    "const elSearch = document.getElementById('searchInput');",
		    "const elSearchResults = document.getElementById('searchResults');",
		    "const elAppRoot = document.getElementById('appRoot');",
	    "",
    "const elDrawer = document.getElementById('drawer');",
    "const elDrawerTitle = document.getElementById('drawerTitle');",
    "const elDrawerArchive = document.getElementById('drawerArchive');",
    "const elDrawerClose = document.getElementById('drawerClose');",
    "const elDrawerErr = document.getElementById('drawerErr');",
    "const elDrawerCardId = document.getElementById('drawerCardId');",
    "const elDrawerTitleInput = document.getElementById('drawerTitleInput');",
    "const elDrawerList = document.getElementById('drawerList');",
    "const elDrawerMoveTo = document.getElementById('drawerMoveTo');",
    "const elDrawerDue = document.getElementById('drawerDue');",
    "const elDrawerLabels = document.getElementById('drawerLabels');",
    "const elDrawerDescription = document.getElementById('drawerDescription');",
    "const elDrawerDescriptionPreview = document.getElementById('drawerDescriptionPreview');",
    "const elDrawerSave = document.getElementById('drawerSave');",
    "const elDrawerChecklist = document.getElementById('drawerChecklist');",
    "const elDrawerChecklistNew = document.getElementById('drawerChecklistNew');",
    "const elDrawerChecklistAdd = document.getElementById('drawerChecklistAdd');",
    "const elDrawerComments = document.getElementById('drawerComments');",
    "const elDrawerCommentNew = document.getElementById('drawerCommentNew');",
	    "const elDrawerCommentAdd = document.getElementById('drawerCommentAdd');",
	    "const elDrawerHistory = document.getElementById('drawerHistory');",
	    "",
	    "const elModalOverlay = document.getElementById('modalOverlay');",
	    "const elModalDialog = document.getElementById('modalDialog');",
	    "const elModalTitle = document.getElementById('modalTitle');",
	    "const elModalClose = document.getElementById('modalClose');",
		    "const elModalBody = document.getElementById('modalBody');",
		    "const elModalErr = document.getElementById('modalErr');",
		    "const elModalDesc = document.getElementById('modalDesc');",
		    "const elModalFooter = document.getElementById('modalFooter');",
		    "",
		    "let state = bootstrap.state;",
		    "let appliedThroughSeq = bootstrap.appliedThroughSeq || 0;",
		    "let selectedBoardId = localStorage.getItem('kanban.selectedBoardId') || '';",
		    "let showArchivedCards = localStorage.getItem('kanban.showArchivedCards') === '1';",
		    "let stream = null;",
		    "let openCardId = null;",
		    "let gitStatus = null;",
		    "let lastAnnouncedStatus = '';",
		    "let drawerTriggerEl = null;",
		    "let drawerTriggerCardId = null;",
			    "let modalMode = null;",
			    "let modalTriggerEl = null;",
			    "let modalBoardId = null;",
			    "let modalData = null;",
			    "let modalCloseTimer = null;",
			    "",
			    "function setModalDescription(msg) {",
			    "  if (!elModalDesc || !elModalDialog) return;",
			    "  const text = msg ? String(msg) : '';",
			    "  elModalDesc.textContent = text;",
			    "  const hasDesc = !!String(text).trim();",
			    "  elModalDialog.setAttribute('aria-describedby', hasDesc ? 'modalDesc modalErr' : 'modalErr');",
			    "}",
			    "",
			    "function renderArchivedToggle() {",
		    "  if (!elArchivedToggle) return;",
		    "  const enabled = !!showArchivedCards;",
		    "  elArchivedToggle.textContent = enabled ? 'Archived: On' : 'Archived: Off';",
	    "  elArchivedToggle.classList.toggle('primary', enabled);",
	    "  elArchivedToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');",
	    "  const boards = boardsInWorkspace();",
	    "  elArchivedToggle.disabled = !boards.length;",
	    "}",
	    "",
	    "function escapeHtml(value) {",
      "  return String(value)",
      "    .replaceAll('&', '&amp;')",
      "    .replaceAll('<', '&lt;')",
      "    .replaceAll('>', '&gt;')",
      "    .replaceAll('\"', '&quot;')",
      "    .replaceAll(\"'\", '&#39;');",
      "}",
      "",
	    "function hashHue(value) {",
	    "  const s = String(value || '');",
	    "  let h = 0;",
	    "  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;",
	    "  return h % 360;",
	    "}",
	    "",
	    "function renderLabelChips(labels) {",
	    "  const arr = Array.isArray(labels) ? labels.map((l) => String(l || '').trim()).filter(Boolean) : [];",
	    "  if (!arr.length) return '';",
	    "  const max = 3;",
	    "  const shown = arr.slice(0, max);",
	    "  const more = arr.length - shown.length;",
	    "  const chips = shown",
	    "    .map((l) => {",
	    "      const hue = hashHue(l);",
	    "      return `<span class=\\\"chip label\\\" style=\\\"--h:${hue}\\\" title=\\\"${escapeHtml(l)}\\\">${escapeHtml(l)}</span>`;",
	    "    })",
	    "    .join('');",
	    "  const moreChip = more > 0 ? `<span class=\\\"chip more\\\" title=\\\"${escapeHtml(String(more))} more labels\\\">+${escapeHtml(String(more))}</span>` : '';",
	    "  return chips + moreChip;",
	    "}",
	    "",
	    "function parseDueMs(dueDate) {",
	    "  const raw = String(dueDate || '').trim();",
	    "  if (!raw) return NaN;",
	    "  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) {",
	    "    const parts = raw.split('-').map((n) => Number.parseInt(n, 10));",
	    "    if (parts.length !== 3) return NaN;",
	    "    const [y, m, d] = parts;",
	    "    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();",
	    "  }",
	    "  const t = Date.parse(raw);",
	    "  return Number.isFinite(t) ? t : NaN;",
	    "}",
	    "",
	    "function formatShortDate(ms) {",
	    "  const d = new Date(ms);",
	    "  const now = new Date();",
	    "  const opts = d.getFullYear() === now.getFullYear()",
	    "    ? { month: 'short', day: 'numeric' }",
	    "    : { month: 'short', day: 'numeric', year: 'numeric' };",
	    "  return d.toLocaleDateString(undefined, opts);",
	    "}",
	    "",
	    "function renderDueBadge(dueDate) {",
	    "  const ms = parseDueMs(dueDate);",
	    "  if (!Number.isFinite(ms)) return '';",
	    "  const overdue = Date.now() > ms;",
	    "  const label = formatShortDate(ms);",
	    "  const cls = overdue ? 'badge due overdue' : 'badge due';",
	    "  const title = overdue ? ('Overdue: ' + label) : ('Due: ' + label);",
	    "  return `<span class=\\\"${cls}\\\" title=\\\"${escapeHtml(title)}\\\">Due ${escapeHtml(label)}</span>`;",
	    "}",
	    "",
	    "function renderChecklistBadge(checklist) {",
	    "  const items = Array.isArray(checklist) ? checklist : [];",
	    "  if (!items.length) return '';",
	    "  let done = 0;",
	    "  for (const it of items) if (it && it.checked) done++;",
	    "  const total = items.length;",
	    "  const cls = done === total ? 'badge ok' : 'badge';",
	    "  return `<span class=\\\"${cls}\\\" title=\\\"Checklist\\\">${escapeHtml(String(done))}/${escapeHtml(String(total))}</span>`;",
	    "}",
	    "",
	    "function renderCommentsBadge(cardId) {",
	    "  const list = state && state.commentsByCardId && state.commentsByCardId[cardId] ? state.commentsByCardId[cardId] : [];",
	    "  const n = Array.isArray(list) ? list.length : 0;",
	    "  if (n <= 0) return '';",
	    "  const title = n === 1 ? '1 comment' : (String(n) + ' comments');",
	    "  return `<span class=\\\"badge\\\" title=\\\"${escapeHtml(title)}\\\">💬 ${escapeHtml(String(n))}</span>`;",
	    "}",
	    "",
      "function renderMarkdown(text) {",
    "  const src = String(text || '');",
    "  const lines = src.split(/\\r?\\n/);",
    "  const out = [];",
    "  for (const line of lines) {",
    "    if (line.startsWith('### ')) out.push('<h3>' + escapeHtml(line.slice(4)) + '</h3>');",
    "    else if (line.startsWith('## ')) out.push('<h2>' + escapeHtml(line.slice(3)) + '</h2>');",
    "    else if (line.startsWith('# ')) out.push('<h1>' + escapeHtml(line.slice(2)) + '</h1>');",
    "    else if (line.trim().length === 0) out.push('<p></p>');",
    "    else {",
    "      let html = escapeHtml(line);",
    "      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');",
    "      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');",
    "      html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');",
    "      out.push('<p>' + html + '</p>');",
    "    }",
    "  }",
    "  return out.join('');",
    "}",
    "",
    "function setStatus(level, text) {",
    "  const dotClass = level === 'ok' ? 'ok' : level === 'bad' ? 'bad' : '';",
    "  const msg = text ? String(text) : '';",
    "  const git = gitStatus",
    '    ? `<span class="pill"><span class="muted">git</span> <code>${escapeHtml(gitStatus)}</code></span>`',
    "    : '';",
    "  const conflictCount = state && Array.isArray(state.conflicts) ? state.conflicts.length : 0;",
    "  const conflicts = conflictCount",
    '    ? `<span class="pill"><span class="muted">conflicts</span> <code>${escapeHtml(String(conflictCount))}</code></span>`',
    "    : '';",
    "  elStatus.innerHTML =",
    '    `<span class="pill"><span class="dot ${dotClass}"></span><span>${escapeHtml(msg)}</span></span>` +',
    '    `<span class="pill"><span class="muted">seq</span> <code>${escapeHtml(String(appliedThroughSeq || 0))}</code></span>` +',
    "    git +",
    "    conflicts;",
    "  if (elStatusLive) {",
    "    const trimmed = msg.trim();",
    "    if (trimmed && trimmed !== lastAnnouncedStatus) {",
    "      lastAnnouncedStatus = trimmed;",
    "      elStatusLive.textContent = trimmed;",
    "    }",
    "  }",
    "}",
    "",
    "async function getJson(url) {",
    "  const res = await fetch(url);",
    "  const json = await res.json().catch(() => ({}));",
    "  if (!res.ok) throw new Error(json && json.error ? json.error : ('HTTP ' + res.status));",
    "  return json;",
    "}",
    "",
    "async function postJson(url, body) {",
    "  const res = await fetch(url, {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json' },",
    "    body: JSON.stringify(body || {}),",
    "  });",
    "  const json = await res.json().catch(() => ({}));",
    "  if (!res.ok) throw new Error(json && json.error ? json.error : ('HTTP ' + res.status));",
    "  return json;",
    "}",
    "",
    "async function refreshGitStatus() {",
    "  try {",
    "    const out = await getJson('/api/git/status');",
    "    const s = out && out.status ? out.status : null;",
    "    if (!s) { gitStatus = null; return; }",
    "    const parts = [];",
    "    if (typeof s.branch === 'string' && s.branch) parts.push(s.branch);",
    "    if (typeof s.ahead === 'number' && s.ahead > 0) parts.push('+' + s.ahead);",
    "    if (typeof s.behind === 'number' && s.behind > 0) parts.push('-' + s.behind);",
    "    if (s.dirty) parts.push('*');",
    "    gitStatus = parts.length ? parts.join(' ') : 'clean';",
    "  } catch {",
    "    gitStatus = null;",
    "  }",
    "}",
    "",
    "function boardsInWorkspace() {",
    "  if (!state) return [];",
    "  const ws = state.workspaces[state.defaultWorkspaceId];",
    "  const boardIds = (ws && ws.boardIds) ? ws.boardIds : Object.keys(state.boards || {});",
    "  return boardIds.map((id) => state.boards[id]).filter(Boolean);",
    "}",
    "",
    "function ensureSelectedBoardId() {",
    "  const boards = boardsInWorkspace();",
    "  if (!boards.length) return '';",
    "  if (selectedBoardId && state.boards[selectedBoardId]) return selectedBoardId;",
    "  selectedBoardId = boards[0].id;",
    "  localStorage.setItem('kanban.selectedBoardId', selectedBoardId);",
    "  return selectedBoardId;",
    "}",
    "",
    "function listOptionsForBoard(boardId) {",
    "  const board = state.boards[boardId];",
    "  if (!board) return [];",
    "  return board.listIds.map((id) => state.lists[id]).filter(Boolean);",
    "}",
    "",
    "function renderBoardSelect() {",
    "  const boards = boardsInWorkspace();",
    "  if (!boards.length) {",
    "    elBoardSelect.innerHTML = '';",
    "    elBoardSelect.disabled = true;",
    "    return;",
    "  }",
    "  elBoardSelect.disabled = false;",
    "  const selected = ensureSelectedBoardId();",
    "  elBoardSelect.innerHTML = boards",
    "    .map((b) => `<option value=\"${escapeHtml(b.id)}\" ${b.id === selected ? 'selected' : ''}>${escapeHtml(b.name)}</option>`)",
    "    .join('');",
    "}",
    "",
    "function renderEmpty() {",
    "  elMain.innerHTML = `",
    '    <div class="empty">',
    "      <h2>No boards yet</h2>",
    "      <p>Create your first board to get started.</p>",
    '      <button id="emptyNewBoard" class="button primary">New board</button>',
    "    </div>`;",
    "  const btn = document.getElementById('emptyNewBoard');",
    "  if (btn) btn.addEventListener('click', () => elNewBoard.click());",
    "}",
    "",
    "function renderBoard(boardId) {",
    "  const board = state.boards[boardId];",
    "  if (!board) return renderEmpty();",
    "",
	    "  const lists = board.listIds.map((id) => state.lists[id]).filter(Boolean);",
	    "  const htmlLists = lists.map((list) => {",
	    "    const allCards = list.cardIds.map((id) => state.cards[id]).filter(Boolean);",
	    "    const activeCards = allCards.filter((c) => !c.archived);",
	    "    const archivedCards = allCards.filter((c) => c.archived);",
	    "    const cards = showArchivedCards ? allCards : activeCards;",
	    "    const listSub = showArchivedCards",
	    "      ? `${activeCards.length} active${archivedCards.length ? (' • ' + archivedCards.length + ' archived') : ''}`",
	    "      : `${activeCards.length} cards`;",
	    "    const cardHtml = cards.map((c) => {",
	    "      const labels = renderLabelChips(c.labels);",
	    "      const due = renderDueBadge(c.dueDate);",
	    "      const checklist = renderChecklistBadge(c.checklist);",
	    "      const comments = renderCommentsBadge(c.id);",
	    "      const idShort = c && c.id ? String(c.id).slice(0, 8) : '';",
	    "      const meta = [",
	    "        due,",
	    "        checklist,",
	    "        comments,",
	    "        (idShort ? `<span>${escapeHtml(idShort)}</span>` : ''),",
	    "        (c.archived ? '<span class=\"badge archived\">Archived</span>' : ''),",
	    "      ].filter(Boolean).join('');",
	    "      return `",
	    '      <div class="card${c.archived ? \' archived\' : \'\'}" draggable="${c.archived ? \'false\' : \'true\'}" data-archived="${c.archived ? \'1\' : \'0\'}" data-card-id="${escapeHtml(c.id)}" data-list-id="${escapeHtml(list.id)}">',
	    "        ${labels ? `<div class=\\\"card-labels\\\">${labels}</div>` : ''}",
	    '        <p class="card-title">${escapeHtml(c.title)}</p>',
	    "        ${meta ? `<div class=\\\"card-meta\\\">${meta}</div>` : ''}",
	    "      </div>`;",
	    "    }).join('');",
    "",
    "    return `",
	    '      <div class="list" draggable="true" data-list-id="${escapeHtml(list.id)}">',
	    '        <div class="list-header">',
	    '          <p class="list-title">${escapeHtml(list.name)}</p>',
	    '          <div class="list-sub">${escapeHtml(listSub)}</div>',
	    "        </div>",
    '        <div class="cards" data-dropzone="1">${cardHtml}</div>',
    '        <div class="composer">',
    '          <div class="composer-row">',
    '            <input class="input" data-new-card-title="1" placeholder="Add a card..." />',
    '            <button class="button primary" data-add-card="1">Add</button>',
    "          </div>",
    "        </div>",
    "      </div>`;",
    "  }).join('');",
    "",
    "  elMain.innerHTML = `",
    '    <div class="board" id="boardRoot">',
    "      ${htmlLists}",
    '      <div class="list" style="background: rgba(255,255,255,0.02);" id="addList">',
    '        <div class="list-header"><p class="list-title">Add a list</p></div>',
    '        <div class="composer">',
    '          <div class="composer-row">',
    '            <input id="newListName" class="input" placeholder="List name..." />',
    '            <button id="addListBtn" class="button primary">Add</button>',
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>`;",
    "",
    "  wireBoardInteractions(boardId);",
    "}",
    "",
    "function wireBoardInteractions(boardId) {",
    "  const root = document.getElementById('boardRoot');",
    "  const addListBtn = document.getElementById('addListBtn');",
    "  const newListName = document.getElementById('newListName');",
    "",
    "  if (addListBtn) addListBtn.addEventListener('click', async () => {",
    "    const name = (newListName && newListName.value ? newListName.value : '').trim();",
    "    if (!name) return;",
    "    try {",
    "      setStatus('ok', 'Creating list...');",
    "      await postJson('/api/lists', { boardId, name });",
    "      newListName.value = '';",
    "      await refreshState();",
    "    } catch (e) {",
    "      setStatus('bad', e && e.message ? e.message : String(e));",
    "    }",
    "  });",
    "  if (newListName) newListName.addEventListener('keydown', (e) => {",
    "    if (e.key === 'Enter') addListBtn.click();",
    "  });",
    "",
    "  root.querySelectorAll('[data-add-card=\"1\"]').forEach((btn) => {",
    "    btn.addEventListener('click', async (ev) => {",
    "      const listEl = ev.target.closest('.list');",
    "      const listId = listEl ? listEl.getAttribute('data-list-id') : '';",
    "      const input = listEl ? listEl.querySelector('[data-new-card-title=\"1\"]') : null;",
    "      const title = input && input.value ? input.value.trim() : '';",
    "      if (!title) return;",
    "      try {",
    "        setStatus('ok', 'Creating card...');",
    "        await postJson('/api/cards', { boardId, listId, title });",
    "        input.value = '';",
    "        await refreshState();",
    "      } catch (e) {",
    "        setStatus('bad', e && e.message ? e.message : String(e));",
    "      }",
    "    });",
    "  });",
    "  root.querySelectorAll('[data-new-card-title=\"1\"]').forEach((input) => {",
    "    input.addEventListener('keydown', (e) => {",
    "      if (e.key !== 'Enter') return;",
    "      const listEl = input.closest('.list');",
    "      const btn = listEl ? listEl.querySelector('[data-add-card=\"1\"]') : null;",
    "      if (btn) btn.click();",
    "    });",
    "  });",
    "",
    "  root.querySelectorAll('.list[draggable=\"true\"]').forEach((listEl) => {",
    "    listEl.addEventListener('dragstart', (ev) => {",
    "      if (!ev.dataTransfer) return;",
    "      const listId = listEl.getAttribute('data-list-id');",
    "      if (!listId) return;",
    "      ev.dataTransfer.setData('text/plain', 'list:' + listId);",
    "      ev.dataTransfer.effectAllowed = 'move';",
    "    });",
    "    listEl.addEventListener('dragover', (ev) => {",
    "      if (!ev.dataTransfer) return;",
    "      const raw = ev.dataTransfer.getData('text/plain') || '';",
    "      if (!raw.startsWith('list:')) return;",
    "      ev.preventDefault();",
    "      listEl.classList.add('drop-target');",
    "      ev.dataTransfer.dropEffect = 'move';",
    "    });",
    "    listEl.addEventListener('dragleave', () => listEl.classList.remove('drop-target'));",
    "    listEl.addEventListener('drop', async (ev) => {",
    "      ev.preventDefault();",
    "      listEl.classList.remove('drop-target');",
    "      if (!ev.dataTransfer) return;",
    "      const raw = ev.dataTransfer.getData('text/plain') || '';",
    "      if (!raw.startsWith('list:')) return;",
    "      const movingListId = raw.slice('list:'.length);",
    "      const targetListId = listEl.getAttribute('data-list-id');",
    "      if (!movingListId || !targetListId || movingListId === targetListId) return;",
    "",
    "      const board = state.boards[boardId];",
    "      if (!board) return;",
    "",
    "      const rect = listEl.getBoundingClientRect();",
    "      const before = ev.clientX < rect.left + rect.width / 2;",
    "",
    "      const ids = board.listIds.filter((id) => id !== movingListId);",
    "      const targetIndex = ids.indexOf(targetListId);",
    "      if (targetIndex < 0) return;",
    "      const insertIndex = before ? targetIndex : targetIndex + 1;",
    "      const prevId = insertIndex > 0 ? ids[insertIndex - 1] : null;",
    "      const nextId = insertIndex < ids.length ? ids[insertIndex] : null;",
    "",
    "      const prevPos = prevId ? (state.lists[prevId] ? state.lists[prevId].position : 0) : null;",
    "      const nextPos = nextId ? (state.lists[nextId] ? state.lists[nextId].position : 0) : null;",
    "",
    "      let position = null;",
    "      if (prevPos !== null && nextPos !== null) position = (prevPos + nextPos) / 2;",
    "      else if (prevPos !== null) position = prevPos + 1000;",
    "      else if (nextPos !== null) position = nextPos - 1000;",
    "",
    "      if (position === null) return;",
    "      try {",
    "        setStatus('ok', 'Reordering list...');",
    "        await postJson('/api/lists/move', { listId: movingListId, position });",
    "        await refreshState();",
    "      } catch (e) {",
    "        setStatus('bad', e && e.message ? e.message : String(e));",
    "      }",
    "    });",
    "  });",
    "",
	    "  root.querySelectorAll('.card').forEach((cardEl) => {",
	    "    cardEl.addEventListener('dragstart', (ev) => {",
	    "      if (cardEl.getAttribute('data-archived') === '1') { ev.preventDefault(); return; }",
	    "      if (!ev.dataTransfer) return;",
	    "      ev.dataTransfer.setData('text/plain', cardEl.getAttribute('data-card-id'));",
	    "      ev.dataTransfer.effectAllowed = 'move';",
	    "    });",
	    "    cardEl.addEventListener('dragover', (ev) => {",
	    "      if (cardEl.getAttribute('data-archived') === '1') return;",
	    "      ev.preventDefault();",
	    "      cardEl.classList.add('drop-target');",
	    "      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';",
	    "    });",
	    "    cardEl.addEventListener('dragleave', () => cardEl.classList.remove('drop-target'));",
	    "    cardEl.addEventListener('drop', async (ev) => {",
	    "      if (cardEl.getAttribute('data-archived') === '1') return;",
	    "      ev.preventDefault();",
	    "      cardEl.classList.remove('drop-target');",
	    "      if (!ev.dataTransfer) return;",
	    "      const movingCardId = ev.dataTransfer.getData('text/plain');",
	    "      const targetCardId = cardEl.getAttribute('data-card-id');",
	    "      if (!movingCardId || !targetCardId || movingCardId === targetCardId) return;",
	    "      if (state && state.cards && state.cards[movingCardId] && state.cards[movingCardId].archived) return;",
    "",
    "      const toListId = cardEl.getAttribute('data-list-id');",
    "      if (!toListId) return;",
    "",
    "      const list = state.lists[toListId];",
    "      if (!list) return;",
    "",
    "      const rect = cardEl.getBoundingClientRect();",
    "      const before = ev.clientY < rect.top + rect.height / 2;",
    "",
    "      const ids = list.cardIds.filter((id) => id !== movingCardId);",
    "      const targetIndex = ids.indexOf(targetCardId);",
    "      if (targetIndex < 0) return;",
    "      const insertIndex = before ? targetIndex : targetIndex + 1;",
    "      const prevId = insertIndex > 0 ? ids[insertIndex - 1] : null;",
    "      const nextId = insertIndex < ids.length ? ids[insertIndex] : null;",
    "",
    "      const prevPos = prevId ? (state.cards[prevId] ? state.cards[prevId].position : 0) : null;",
    "      const nextPos = nextId ? (state.cards[nextId] ? state.cards[nextId].position : 0) : null;",
    "",
    "      let position = null;",
    "      if (prevPos !== null && nextPos !== null) position = (prevPos + nextPos) / 2;",
    "      else if (prevPos !== null) position = prevPos + 1000;",
    "      else if (nextPos !== null) position = nextPos - 1000;",
    "",
    "      try {",
    "        setStatus('ok', 'Moving card...');",
    "        const body = position === null ? { cardId: movingCardId, toListId } : { cardId: movingCardId, toListId, position };",
    "        await postJson('/api/cards/move', body);",
    "        await refreshState();",
    "      } catch (e) {",
    "        setStatus('bad', e && e.message ? e.message : String(e));",
    "      }",
	    "    });",
	    "    if (!cardEl.hasAttribute('tabindex')) cardEl.setAttribute('tabindex', '0');",
	    "    if (!cardEl.hasAttribute('role')) cardEl.setAttribute('role', 'button');",
	    "    cardEl.setAttribute('aria-haspopup', 'dialog');",
    "    cardEl.addEventListener('click', () => openCard(cardEl.getAttribute('data-card-id'), cardEl));",
	    "    cardEl.addEventListener('keydown', (e) => {",
	    "      if (e.key !== 'Enter' && e.key !== ' ') return;",
	    "      e.preventDefault();",
	    "      openCard(cardEl.getAttribute('data-card-id'), cardEl);",
	    "    });",
 	    "  });",
    "",
    "  root.querySelectorAll('[data-dropzone=\"1\"]').forEach((zone) => {",
    "    zone.addEventListener('dragover', (ev) => {",
    "      ev.preventDefault();",
    "      zone.classList.add('drop-target');",
    "      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';",
    "    });",
    "    zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));",
    "    zone.addEventListener('drop', async (ev) => {",
    "      ev.preventDefault();",
    "      zone.classList.remove('drop-target');",
    "      if (!ev.dataTransfer) return;",
    "      const cardId = ev.dataTransfer.getData('text/plain');",
    "      const listEl = zone.closest('.list');",
    "      const toListId = listEl ? listEl.getAttribute('data-list-id') : '';",
    "      if (!cardId || !toListId) return;",
    "      try {",
    "        setStatus('ok', 'Moving card...');",
    "        await postJson('/api/cards/move', { cardId, toListId });",
    "        await refreshState();",
    "      } catch (e) {",
    "        setStatus('bad', e && e.message ? e.message : String(e));",
    "      }",
    "    });",
    "  });",
    "}",
    "",
    "async function refreshState() {",
    "  const data = await getJson('/api/state');",
    "  state = data.state;",
    "  appliedThroughSeq = data.appliedThroughSeq || 0;",
    "  await refreshGitStatus();",
    "  render();",
    "  startStream();",
    "  setStatus('ok', 'Up to date');",
    "}",
    "",
	    "function render() {",
	    "  if (!state) return;",
	    "  renderBoardSelect();",
	    "  renderArchivedToggle();",
	    "  const boards = boardsInWorkspace();",
    "  if (!boards.length) return renderEmpty();",
    "  const boardId = ensureSelectedBoardId();",
    "  renderBoard(boardId);",
    "}",
      "",
      "async function openCard(cardId, triggerEl) {",
      "  if (!cardId) return;",
      "  const card = state.cards[cardId];",
      "  if (!card) return;",
      "  const list = state.lists[card.listId];",
      "  const board = state.boards[card.boardId];",
      "",
      "  const wasOpen = isDrawerOpen();",
      "  if (!wasOpen) {",
      "    drawerTriggerEl = (triggerEl && triggerEl.focus) ? triggerEl : (document.activeElement && document.activeElement.focus ? document.activeElement : null);",
      "    drawerTriggerCardId = cardId;",
      "  }",
    "",
    "  openCardId = cardId;",
    "  elDrawerErr.textContent = '';",
    "  elDrawerTitle.textContent = card.title || 'Card';",
    "  elDrawerTitleInput.value = card.title || '';",
    "  elDrawerCardId.textContent = card.id;",
    "  elDrawerList.textContent = (list ? list.name : card.listId) + (board ? (' - ' + board.name) : '');",
    "  elDrawerDue.value = card.dueDate || '';",
    "  elDrawerLabels.value = (card.labels || []).join(', ');",
    "  elDrawerDescription.value = card.description || '';",
    "  elDrawerDescriptionPreview.innerHTML = renderMarkdown(card.description || '');",
    "  elDrawerArchive.textContent = card.archived ? 'Restore' : 'Archive';",
    "",
    "  const lists = listOptionsForBoard(card.boardId);",
    "  elDrawerMoveTo.innerHTML = lists",
    "    .map((l) => `<option value=\"${escapeHtml(l.id)}\" ${l.id === card.listId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`)",
    "    .join('');",
    "",
    "  elDrawerMoveTo.onchange = async () => {",
    "    const toListId = elDrawerMoveTo.value;",
    "    if (!toListId || toListId === card.listId) return;",
    "    try {",
    "      setStatus('ok', 'Moving card...');",
    "      await postJson('/api/cards/move', { cardId, toListId });",
    "      await refreshState();",
    "      await openCard(cardId);",
    "    } catch (e) {",
    "      elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "    }",
    "  };",
    "",
    "  elDrawerSave.onclick = async () => {",
    "    try {",
    "      const title = elDrawerTitleInput.value.trim();",
    "      const description = elDrawerDescription.value;",
    "      const dueRaw = elDrawerDue.value.trim();",
    "      const dueDate = dueRaw ? dueRaw : null;",
    "      if (dueDate !== null && !Number.isFinite(Date.parse(dueDate))) {",
    "        throw new Error('Invalid due date; expected ISO string or blank');",
    "      }",
    "      const labels = elDrawerLabels.value",
    "        .split(',')",
    "        .map((s) => s.trim())",
    "        .filter(Boolean);",
    "      setStatus('ok', 'Saving...');",
    "      await postJson('/api/cards/update', { cardId, title, description, dueDate, labels });",
    "      await refreshState();",
    "      await openCard(cardId);",
    "    } catch (e) {",
    "      elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "    }",
    "  };",
    "",
    "  elDrawerDescription.oninput = () => {",
    "    elDrawerDescriptionPreview.innerHTML = renderMarkdown(elDrawerDescription.value);",
    "  };",
    "",
    "  elDrawerArchive.onclick = async () => {",
    "    try {",
    "      setStatus('ok', card.archived ? 'Restoring...' : 'Archiving...');",
    "      await postJson('/api/cards/archive', { cardId, archived: !card.archived });",
    "      await refreshState();",
    "      await openCard(cardId);",
    "    } catch (e) {",
    "      elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "    }",
    "  };",
    "",
    "  const checklist = Array.isArray(card.checklist) ? card.checklist : [];",
    "  if (!checklist.length) elDrawerChecklist.innerHTML = '<div class=\"muted\">No items yet.</div>';",
    "  else {",
    "    elDrawerChecklist.innerHTML = checklist.map((it) => `",
    '      <div class="checklist-item" data-item-id="${escapeHtml(it.id)}">',
    "        <input type=\"checkbox\" ${it.checked ? 'checked' : ''} />",
    "        <div class=\"text ${it.checked ? 'done' : ''}\">${escapeHtml(it.text)}</div>",
    '        <button class="button" data-remove="1">Remove</button>',
    "      </div>`).join('');",
    "  }",
    "  elDrawerChecklist.querySelectorAll('.checklist-item').forEach((row) => {",
    "    const itemId = row.getAttribute('data-item-id');",
    "    const cb = row.querySelector('input[type=\"checkbox\"]');",
    "    const removeBtn = row.querySelector('[data-remove=\"1\"]');",
    "    const textEl = row.querySelector('.text');",
    "    if (cb) cb.addEventListener('change', async () => {",
    "      try {",
    "        await postJson('/api/cards/checklist/toggle', { cardId, itemId, checked: !!cb.checked });",
    "        await refreshState();",
    "        await openCard(cardId);",
    "      } catch (e) {",
    "        elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "      }",
    "    });",
    "    if (removeBtn) removeBtn.addEventListener('click', async () => {",
    "      try {",
    "        await postJson('/api/cards/checklist/remove', { cardId, itemId });",
    "        await refreshState();",
    "        await openCard(cardId);",
    "      } catch (e) {",
    "        elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "      }",
    "    });",
		    "    if (textEl) textEl.addEventListener('dblclick', async () => {",
		    "      openModal('renameChecklistItem', null, { cardId, itemId, text: textEl.textContent || '' });",
		    "    });",
    "  });",
    "",
    "  elDrawerChecklistAdd.onclick = async () => {",
    "    const text = elDrawerChecklistNew.value.trim();",
    "    if (!text) return;",
    "    try {",
    "      await postJson('/api/cards/checklist/add', { cardId, text });",
    "      elDrawerChecklistNew.value = '';",
    "      await refreshState();",
    "      await openCard(cardId);",
    "    } catch (e) {",
    "      elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "    }",
    "  };",
    "  elDrawerChecklistNew.onkeydown = (e) => { if (e.key === 'Enter') elDrawerChecklistAdd.click(); };",
    "",
    "  const comments = (state.commentsByCardId && state.commentsByCardId[cardId]) ? state.commentsByCardId[cardId] : [];",
    "  if (!comments.length) elDrawerComments.innerHTML = '<div class=\"muted\">No comments yet.</div>';",
    "  else {",
    "    elDrawerComments.innerHTML = comments.map((c) => `",
    '      <div class="comment">',
    '        <div class="meta">${escapeHtml(c.ts)} - ${escapeHtml(c.actorId)}</div>',
    '        <div class="body">${escapeHtml(c.text)}</div>',
    "      </div>`).join('');",
    "  }",
    "",
    "  elDrawerCommentAdd.onclick = async () => {",
    "    const text = elDrawerCommentNew.value.trim();",
    "    if (!text) return;",
    "    try {",
    "      await postJson('/api/cards/comments', { cardId, text });",
    "      elDrawerCommentNew.value = '';",
    "      await refreshState();",
    "      await openCard(cardId);",
    "    } catch (e) {",
    "      elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "    }",
    "  };",
    "",
    "  elDrawerHistory.innerHTML = '<div class=\"muted\">Loading...</div>';",
    "  try {",
    "    const hist = await getJson('/api/cards/history?cardId=' + encodeURIComponent(cardId));",
    "    const items = hist.items || [];",
    "    if (!items.length) elDrawerHistory.innerHTML = '<div class=\"muted\">No history yet.</div>';",
    "    else {",
    "      elDrawerHistory.innerHTML = items.map((it) => `",
    '        <div class="history-item">',
    '          <div class="when">${escapeHtml(it.ts)} - ${escapeHtml(it.actorId)}</div>',
    '          <div class="what">${escapeHtml(it.summary)}</div>',
    "        </div>`).join('');",
    "    }",
    "  } catch (e) {",
    "    elDrawerHistory.innerHTML = '';",
    "    elDrawerErr.textContent = e && e.message ? e.message : String(e);",
    "  }",
    "",
      "  elDrawer.classList.add('open');",
      "  elDrawer.setAttribute('aria-hidden', 'false');",
      "  if (!wasOpen) {",
      "    setDrawerInert(true);",
      "    setTimeout(() => {",
      "      if (!isDrawerOpen()) return;",
      "      const focusables = getFocusable(elDrawer);",
      "      const preferred = elDrawerTitleInput && elDrawerTitleInput.focus ? elDrawerTitleInput : null;",
      "      const target = (preferred && focusables.includes(preferred)) ? preferred : (focusables[0] || elDrawer);",
      "      if (target && target.focus) target.focus();",
      "    }, 0);",
      "  }",
      "}",
      "",
	    "function closeDrawer() {",
	    "  if (!isDrawerOpen()) return;",
	    "  elDrawer.classList.remove('open');",
	    "  elDrawer.setAttribute('aria-hidden', 'true');",
	    "  elDrawerErr.textContent = '';",
	    "  openCardId = null;",
	    "  setDrawerInert(false);",
	    "  restoreDrawerFocus();",
	    "}",
	    "",
	    "function setModalError(msg) {",
	    "  elModalErr.textContent = msg ? String(msg) : '';",
	    "}",
	    "",
		    "function isModalOpen() {",
		    "  return !!modalMode && !!elModalOverlay && !elModalOverlay.hidden;",
		    "}",
		    "",
		    "function setAppInert(on) {",
		    "  if (!elAppRoot) return;",
		    "  if (on) elAppRoot.setAttribute('aria-hidden', 'true');",
		    "  else elAppRoot.removeAttribute('aria-hidden');",
		    "  try {",
		    "    if ('inert' in elAppRoot) elAppRoot.inert = !!on;",
		    "  } catch (_) {}",
		    "}",
		    "",
		    "function isDrawerOpen() {",
		    "  return !!elDrawer && elDrawer.classList.contains('open') && elDrawer.getAttribute('aria-hidden') !== 'true';",
		    "}",
		    "",
		    "function cssEscape(value) {",
		    "  const s = String(value || '');",
		    "  try {",
		    "    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);",
		    "  } catch (_) {}",
		    "  return s.replace(/[\"\\\\]/g, '\\\\$&');",
		    "}",
		    "",
		    "function setDrawerInert(on) {",
		    "  const els = [elTopbar, elWrap];",
		    "  for (const el of els) {",
		    "    if (!el) continue;",
		    "    if (on) el.setAttribute('aria-hidden', 'true');",
		    "    else el.removeAttribute('aria-hidden');",
		    "    try {",
		    "      if ('inert' in el) el.inert = !!on;",
		    "    } catch (_) {}",
		    "  }",
		    "}",
		    "",
		    "function restoreDrawerFocus() {",
		    "  const restore = drawerTriggerEl;",
		    "  const cardId = drawerTriggerCardId;",
		    "  drawerTriggerEl = null;",
		    "  drawerTriggerCardId = null;",
		    "  setTimeout(() => {",
		    "    let target = (restore && restore.focus && restore.isConnected) ? restore : null;",
		    "    if (!target && cardId) {",
		    "      target = document.querySelector('.card[data-card-id=\"' + cssEscape(cardId) + '\"]');",
		    "    }",
		    "    if (target && target.focus) target.focus();",
		    "  }, 0);",
		    "}",
		    "",
		    "function getFocusable(container) {",
		    "  if (!container) return [];",
	    "  const nodes = container.querySelectorAll(",
	    "    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])'",
	    "  );",
	    "  return Array.from(nodes).filter((el) => {",
	    "    if (!el || !el.focus) return false;",
	    "    const style = window.getComputedStyle(el);",
	    "    return style && style.visibility !== 'hidden' && style.display !== 'none';",
	    "  });",
	    "}",
	    "",
		    "function trapModalTab(e) {",
		    "  const focusables = getFocusable(elModalDialog);",
		    "  const active = document.activeElement;",
		    "  if (!elModalDialog) return;",
		    "  if (!focusables.length) {",
		    "    if (elModalDialog.focus) { e.preventDefault(); elModalDialog.focus(); }",
		    "    return;",
		    "  }",
		    "  const first = focusables[0];",
		    "  const last = focusables[focusables.length - 1];",
		    "  if (!active || !elModalDialog.contains(active)) {",
		    "    e.preventDefault();",
		    "    if (first && first.focus) first.focus();",
		    "    return;",
		    "  }",
		    "  if (focusables.length === 1) {",
		    "    e.preventDefault();",
		    "    first.focus();",
		    "    return;",
		    "  }",
		    "  if (e.shiftKey && active === first) {",
		    "    e.preventDefault();",
		    "    last.focus();",
		    "    return;",
		    "  }",
		    "  if (!e.shiftKey && active === last) {",
		    "    e.preventDefault();",
		    "    first.focus();",
		    "  }",
		    "}",
		    "",
		    "function trapDrawerTab(e) {",
		    "  const focusables = getFocusable(elDrawer);",
		    "  const active = document.activeElement;",
		    "  if (!elDrawer) return;",
		    "  if (!focusables.length) {",
		    "    if (elDrawer.focus) { e.preventDefault(); elDrawer.focus(); }",
		    "    return;",
		    "  }",
		    "  const first = focusables[0];",
		    "  const last = focusables[focusables.length - 1];",
		    "  if (!active || !elDrawer.contains(active)) {",
		    "    e.preventDefault();",
		    "    if (first && first.focus) first.focus();",
		    "    return;",
		    "  }",
		    "  if (focusables.length === 1) {",
		    "    e.preventDefault();",
		    "    first.focus();",
		    "    return;",
		    "  }",
		    "  if (e.shiftKey && active === first) {",
		    "    e.preventDefault();",
		    "    last.focus();",
		    "    return;",
		    "  }",
		    "  if (!e.shiftKey && active === last) {",
		    "    e.preventDefault();",
		    "    first.focus();",
		    "  }",
		    "}",
		    "",
		    "function focusModalInitial() {",
		    "  if (!elModalDialog) return;",
		    "  const auto = elModalDialog.querySelector('[data-autofocus]');",
		    "  const first = auto || getFocusable(elModalDialog)[0] || elModalDialog;",
		    "  try {",
		    "    if (first && first.focus) first.focus({ preventScroll: true });",
		    "  } catch (_) {",
		    "    if (first && first.focus) first.focus();",
		    "  }",
		    "}",
		    "",
		    "function openModal(mode, triggerEl, data) {",
		    "  if (!elModalOverlay || !elModalDialog) return;",
		    "  if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }",
		    "  modalMode = mode;",
		    "  modalData = data || null;",
		    "  modalTriggerEl = triggerEl || (document.activeElement instanceof HTMLElement ? document.activeElement : null);",
		    "  modalBoardId = modalData && modalData.boardId ? modalData.boardId : null;",
		    "  setModalError('');",
		    "  elModalOverlay.hidden = false;",
		    "  elModalOverlay.setAttribute('aria-hidden', 'false');",
		    "  setAppInert(true);",
		    "  document.body.classList.add('modal-open');",
		    "  renderModal();",
		    "  requestAnimationFrame(() => {",
		    "    elModalOverlay.classList.add('open');",
		    "    focusModalInitial();",
		    "  });",
		    "}",
		    "",
		    "function closeModal() {",
		    "  if (!elModalOverlay || !elModalDialog) return;",
		    "  if (elModalOverlay.hidden) return;",
		    "  elModalOverlay.classList.remove('open');",
		    "  elModalOverlay.setAttribute('aria-hidden', 'true');",
		    "  document.body.classList.remove('modal-open');",
		    "  const restore = modalTriggerEl;",
		    "  modalMode = null;",
		    "  modalBoardId = null;",
		    "  modalTriggerEl = null;",
		    "  modalData = null;",
		    "  setModalError('');",
		    "  setModalDescription('');",
		    "  elModalBody.innerHTML = '';",
		    "  elModalFooter.innerHTML = '';",
		    "  modalCloseTimer = setTimeout(() => {",
		    "    elModalOverlay.hidden = true;",
		    "    setAppInert(false);",
		    "    if (restore && restore.focus && restore.isConnected) restore.focus();",
		    "  }, 140);",
		    "}",
	    "",
		    "function renderModal() {",
		    "  if (!modalMode) return;",
		    "  if (modalMode === 'newBoard') return renderNewBoardModal();",
		    "  if (modalMode === 'members') return renderMembersModal();",
		    "  if (modalMode === 'renameChecklistItem') return renderRenameChecklistItemModal();",
		    "}",
		    "",
		    "function renderNewBoardModal() {",
		    "  elModalTitle.textContent = 'New board';",
		    "  setModalDescription('Create a new board. Name is required.');",
		    "  elModalBody.innerHTML = `",
	    '    <form id="newBoardForm" class="modal-form">',
	    '      <div class="form-row">',
	    '        <label class="help" for="newBoardName">Name</label>',
	    '        <input id="newBoardName" class="input" placeholder="e.g. Roadmap" autocomplete="off" data-autofocus />',
	    '        <div id="newBoardInlineErr" class="inline-error" aria-live="polite"></div>',
	    "      </div>",
	    "    </form>`;",
	    "  elModalFooter.innerHTML = `",
	    '    <button id="newBoardCancel" type="button" class="button">Cancel</button>',
	    '    <button id="newBoardCreate" type="submit" form="newBoardForm" class="button primary" disabled>Create</button>',
	    "  `;",
	    "",
	    "  const form = document.getElementById('newBoardForm');",
	    "  const input = document.getElementById('newBoardName');",
	    "  const inlineErr = document.getElementById('newBoardInlineErr');",
	    "  const btnCancel = document.getElementById('newBoardCancel');",
	    "  const btnCreate = document.getElementById('newBoardCreate');",
	    "  let busy = false;",
	    "",
		    "  function sync() {",
		    "    const name = (input && input.value ? input.value : '').trim();",
		    "    const empty = !name;",
		    "    if (input) input.disabled = !!busy;",
		    "    if (btnCreate) btnCreate.disabled = busy || empty;",
		    "    if (inlineErr) inlineErr.textContent = empty ? 'Name is required.' : '';",
		    "  }",
	    "",
	    "  if (btnCancel) btnCancel.addEventListener('click', closeModal);",
	    "  if (input) input.addEventListener('input', () => { serverErr = ''; sync(); });",
	    "  sync();",
	    "",
	    "  if (form) form.addEventListener('submit', async (e) => {",
	    "    e.preventDefault();",
	    "    if (!input) return;",
	    "    const name = input.value.trim();",
	    "    if (!name) { sync(); input.focus(); return; }",
	    "",
	    "    busy = true;",
	    "    setModalError('');",
	    "    if (btnCancel) btnCancel.disabled = true;",
	    "    if (btnCreate) { btnCreate.disabled = true; btnCreate.textContent = 'Creating...'; }",
	    "",
	    "    try {",
	    "      setStatus('ok', 'Creating board...');",
	    "      const out = await postJson('/api/boards', { name });",
	    "      selectedBoardId = out.boardId;",
	    "      localStorage.setItem('kanban.selectedBoardId', selectedBoardId);",
	    "      await refreshState();",
	    "      closeModal();",
	    "    } catch (e2) {",
	    "      setModalError(e2 && e2.message ? e2.message : String(e2));",
	    "      setStatus('bad', e2 && e2.message ? e2.message : String(e2));",
	    "    } finally {",
	    "      busy = false;",
	    "      if (btnCancel) btnCancel.disabled = false;",
	    "      if (btnCreate) btnCreate.textContent = 'Create';",
	    "      sync();",
	    "    }",
	    "  });",
	    "}",
	    "",
		    "function renderMembersModal() {",
		    "  const boardId = modalBoardId || ensureSelectedBoardId();",
		    "  const board = state && state.boards ? state.boards[boardId] : null;",
		    "  elModalTitle.textContent = 'Members';",
		    "  if (!board) {",
		    "    setModalDescription('View and manage members. Select a board first.');",
		    "    elModalBody.innerHTML = '<div class=\"muted\">No board selected.</div>';",
		    "    elModalFooter.innerHTML = '<button type=\"button\" class=\"button\" id=\"membersClose\">Close</button>';",
		    "    const closeBtn = document.getElementById('membersClose');",
		    "    if (closeBtn) closeBtn.addEventListener('click', closeModal);",
		    "    return;",
		    "  }",
		    "  setModalDescription('View and manage members for this board. Add or update by actorId and role.');",
		    "",
	    "  elModalBody.innerHTML = `",
	    "    <div class=\"help\">Board: <strong>${escapeHtml(board.name || board.id)}</strong></div>",
	    "    <div id=\"membersList\" class=\"members-list\" aria-live=\"polite\"></div>",
	    "    <div class=\"kv\">",
	    "      <div class=\"k\">Add or update</div>",
	    "      <form id=\"memberAddForm\" class=\"two-col\">",
	    "        <input id=\"memberActorId\" class=\"input\" placeholder=\"actorId\" autocomplete=\"off\" data-autofocus />",
	    "        <select id=\"memberRole\" class=\"select\">",
	    "          <option value=\"viewer\">viewer</option>",
	    "          <option value=\"editor\">editor</option>",
	    "        </select>",
	    "      </form>",
	    "      <div id=\"memberInlineErr\" class=\"inline-error\" aria-live=\"polite\"></div>",
	    "    </div>`;",
	    "  elModalFooter.innerHTML = `",
	    "    <button id=\"membersClose\" type=\"button\" class=\"button\">Close</button>",
	    "    <button id=\"memberAddBtn\" type=\"submit\" form=\"memberAddForm\" class=\"button primary\" disabled>Add</button>",
	    "  `;",
	    "",
	    "  const listEl = document.getElementById('membersList');",
	    "  const form = document.getElementById('memberAddForm');",
	    "  const input = document.getElementById('memberActorId');",
	    "  const roleSel = document.getElementById('memberRole');",
	    "  const addBtn = document.getElementById('memberAddBtn');",
	    "  const inlineErr = document.getElementById('memberInlineErr');",
	    "  const closeBtn = document.getElementById('membersClose');",
	    "  let busy = false;",
	    "  let serverErr = '';",
	    "",
	    "  function sync() {",
	    "    const memberId = (input && input.value ? input.value : '').trim();",
	    "    if (input) input.disabled = !!busy;",
	    "    if (roleSel) roleSel.disabled = !!busy;",
	    "    if (closeBtn) closeBtn.disabled = !!busy;",
	    "    if (addBtn) addBtn.disabled = busy || !memberId;",
	    "    if (inlineErr) {",
	    "      if (!memberId) inlineErr.textContent = 'actorId is required.';",
	    "      else inlineErr.textContent = serverErr ? String(serverErr) : '';",
	    "    }",
	    "  }",
	    "",
	    "  function renderMembersList() {",
	    "    if (!listEl) return;",
	    "    const memberships = (state && state.memberships && state.memberships[boardId]) ? state.memberships[boardId] : {};",
	    "    const ids = Object.keys(memberships || {}).sort();",
	    "    if (!ids.length) {",
	    "      listEl.innerHTML = '<div class=\"muted\">No members yet.</div>';",
	    "      return;",
	    "    }",
	    "    listEl.innerHTML = ids.map((id) => {",
	    "      const role = memberships[id];",
	    "      const roleLabel = role === 'editor' ? 'editor' : 'viewer';",
	    "      const opts = ['viewer','editor'].map((r) => `<option value=\"${r}\" ${r === roleLabel ? 'selected' : ''}>${r}</option>`).join('');",
	    "      return `",
	    "        <div class=\"member-row\" data-member-id=\"${escapeHtml(id)}\">",
	    "          <div>",
	    "            <div class=\"id\"><code>${escapeHtml(id)}</code></div>",
	    "            <div class=\"meta\">Current role: <span>${escapeHtml(roleLabel)}</span></div>",
	    "            <div class=\"muted\" data-member-status aria-live=\"polite\"></div>",
	    "            <div class=\"inline-error\" data-member-error aria-live=\"polite\"></div>",
	    "          </div>",
	    "          <select class=\"select member-role\" aria-label=\"Role for ${escapeHtml(id)}\" data-member-id=\"${escapeHtml(id)}\">${opts}</select>",
	    "        </div>`;",
	    "    }).join('');",
	    "",
	    "    listEl.querySelectorAll('select.member-role[data-member-id]').forEach((sel) => {",
	    "      sel.addEventListener('change', async () => {",
	    "        const memberId = sel.getAttribute('data-member-id');",
	    "        const role = String(sel.value || '').trim().toLowerCase();",
	    "        if (!memberId) return;",
	    "        if (role !== 'viewer' && role !== 'editor') return;",
	    "        const row = sel.closest('.member-row');",
	    "        const rowStatus = row ? row.querySelector('[data-member-status]') : null;",
	    "        const rowErr = row ? row.querySelector('[data-member-error]') : null;",
	    "        try {",
	    "          sel.disabled = true;",
	    "          if (row) row.classList.add('saving');",
	    "          setModalError('');",
	    "          if (rowErr) rowErr.textContent = '';",
	    "          if (rowStatus) rowStatus.textContent = 'Saving...';",
	    "          sel.removeAttribute('aria-invalid');",
	    "          setStatus('ok', 'Updating member...');",
	    "          await postJson('/api/members/role', { boardId, memberId, role });",
	    "          await refreshState();",
	    "          if (isModalOpen()) renderMembersList();",
	    "        } catch (e2) {",
	    "          const msg = e2 && e2.message ? e2.message : String(e2);",
	    "          if (rowErr) rowErr.textContent = msg;",
	    "          if (rowStatus) rowStatus.textContent = '';",
	    "          sel.setAttribute('aria-invalid', 'true');",
	    "          setStatus('bad', msg);",
	    "        } finally {",
	    "          sel.disabled = false;",
	    "          if (row) row.classList.remove('saving');",
	    "          if (rowStatus) rowStatus.textContent = '';",
	    "        }",
	    "      });",
	    "    });",
	    "  }",
	    "",
	    "  if (closeBtn) closeBtn.addEventListener('click', closeModal);",
	    "  if (input) input.addEventListener('input', sync);",
	    "  sync();",
	    "  renderMembersList();",
	    "",
	    "  if (form) form.addEventListener('submit', async (e) => {",
	    "    e.preventDefault();",
	    "    if (!input || !roleSel) return;",
	    "    const memberId = input.value.trim();",
	    "    const role = String(roleSel.value || '').trim().toLowerCase();",
	    "    if (!memberId) { sync(); input.focus(); return; }",
	    "    if (role !== 'viewer' && role !== 'editor') return;",
	    "",
	    "    busy = true;",
	    "    serverErr = '';",
	    "    setModalError('');",
	    "    sync();",
	    "    if (addBtn) addBtn.textContent = 'Saving...';",
	    "",
	    "    try {",
	    "      setStatus('ok', 'Updating members...');",
	    "      const memberships = (state && state.memberships && state.memberships[boardId]) ? state.memberships[boardId] : {};",
	    "      if (memberships && memberships[memberId]) {",
	    "        await postJson('/api/members/role', { boardId, memberId, role });",
	    "      } else {",
	    "        try {",
	    "          await postJson('/api/members/add', { boardId, memberId, role });",
	    "        } catch (e2) {",
	    "          const msg = e2 && e2.message ? e2.message : String(e2);",
	    "          if (String(msg).includes('already exists')) {",
	    "            await postJson('/api/members/role', { boardId, memberId, role });",
	    "          } else {",
	    "            throw e2;",
	    "          }",
	    "        }",
	    "      }",
	    "      await refreshState();",
	    "      if (isModalOpen()) renderMembersList();",
	    "      input.value = '';",
	    "      serverErr = '';",
	    "      sync();",
	    "      input.focus();",
	    "    } catch (e3) {",
	    "      const msg = e3 && e3.message ? e3.message : String(e3);",
	    "      serverErr = msg;",
	    "      setStatus('bad', msg);",
	    "      sync();",
	    "    } finally {",
	    "      busy = false;",
	    "      if (addBtn) addBtn.textContent = 'Add';",
	    "      sync();",
	    "    }",
		    "  });",
		    "}",
		    "",
		    "function renderRenameChecklistItemModal() {",
		    "  const d = modalData || {};",
		    "  const cardId = d.cardId;",
		    "  const itemId = d.itemId;",
		    "  const initialText = d.text || '';",
		    "  elModalTitle.textContent = 'Rename checklist item';",
		    "  setModalDescription('Rename a checklist item.');",
		    "  if (!cardId || !itemId) {",
		    "    elModalBody.innerHTML = '<div class=\"muted\">Missing checklist item.</div>';",
		    "    elModalFooter.innerHTML = '<button type=\"button\" class=\"button\" id=\"renameChecklistClose\">Close</button>';",
		    "    const closeBtn = document.getElementById('renameChecklistClose');",
		    "    if (closeBtn) closeBtn.addEventListener('click', closeModal);",
		    "    return;",
		    "  }",
		    "",
		    "  elModalBody.innerHTML = `",
		    '    <form id="renameChecklistForm" class="modal-form">',
		    '      <div class="form-row">',
		    '        <label class="help" for="renameChecklistText">Text</label>',
		    '        <input id="renameChecklistText" class="input" autocomplete="off" data-autofocus />',
		    '        <div id="renameChecklistInlineErr" class="inline-error" aria-live="polite"></div>',
		    "      </div>",
		    "    </form>`;",
		    "  elModalFooter.innerHTML = `",
		    '    <button id="renameChecklistCancel" type="button" class="button">Cancel</button>',
		    '    <button id="renameChecklistSave" type="submit" form="renameChecklistForm" class="button primary" disabled>Save</button>',
		    "  `;",
		    "",
		    "  const form = document.getElementById('renameChecklistForm');",
		    "  const input = document.getElementById('renameChecklistText');",
		    "  const inlineErr = document.getElementById('renameChecklistInlineErr');",
		    "  const btnCancel = document.getElementById('renameChecklistCancel');",
		    "  const btnSave = document.getElementById('renameChecklistSave');",
		    "  let busy = false;",
		    "",
		    "  if (input) input.value = String(initialText || '');",
		    "",
		    "  function sync() {",
		    "    const val = (input && input.value ? input.value : '').trim();",
		    "    const empty = !val;",
		    "    if (btnSave) btnSave.disabled = busy || empty;",
		    "    if (inlineErr) inlineErr.textContent = empty ? 'Text is required.' : '';",
		    "  }",
		    "",
		    "  if (btnCancel) btnCancel.addEventListener('click', closeModal);",
		    "  if (input) input.addEventListener('input', sync);",
		    "  sync();",
		    "",
		    "  if (form) form.addEventListener('submit', async (e) => {",
		    "    e.preventDefault();",
		    "    if (!input) return;",
		    "    const text = input.value.trim();",
		    "    if (!text) { sync(); input.focus(); return; }",
		    "",
		    "    busy = true;",
		    "    setModalError('');",
		    "    if (btnCancel) btnCancel.disabled = true;",
		    "    if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Saving...'; }",
		    "    sync();",
		    "",
		    "    try {",
		    "      setStatus('ok', 'Renaming checklist item...');",
		    "      await postJson('/api/cards/checklist/rename', { cardId, itemId, text });",
		    "      await refreshState();",
		    "      await openCard(cardId);",
		    "      closeModal();",
		    "    } catch (e2) {",
		    "      setModalError(e2 && e2.message ? e2.message : String(e2));",
		    "      setStatus('bad', e2 && e2.message ? e2.message : String(e2));",
		    "      sync();",
		    "    } finally {",
		    "      busy = false;",
		    "      if (btnCancel) btnCancel.disabled = false;",
		    "      if (btnSave) btnSave.textContent = 'Save';",
		    "      sync();",
		    "    }",
		    "  });",
		    "}",
		    "",
		    "elDrawerClose.addEventListener('click', closeDrawer);",
		    "if (elModalClose) elModalClose.addEventListener('click', closeModal);",
		    "if (elModalOverlay) elModalOverlay.addEventListener('click', (e) => { if (e.target === elModalOverlay) closeModal(); });",
			    "document.addEventListener('keydown', (e) => {",
			    "  if (e.key === 'Escape') {",
			    "    if (isModalOpen()) { e.preventDefault(); e.stopPropagation(); closeModal(); return; }",
			    "    if (isDrawerOpen()) { e.preventDefault(); e.stopPropagation(); closeDrawer(); return; }",
			    "  }",
		    "  if (e.key === 'Tab') {",
		    "    if (isModalOpen()) trapModalTab(e);",
		    "    else if (isDrawerOpen()) trapDrawerTab(e);",
		    "  }",
		    "});",
		    "",
		    "document.addEventListener('focusin', (e) => {",
		    "  if (isModalOpen()) return;",
		    "  if (!isDrawerOpen()) return;",
		    "  const t = e && e.target ? e.target : null;",
		    "  if (t && elDrawer && elDrawer.contains(t)) return;",
		    "  const focusables = getFocusable(elDrawer);",
		    "  const target = focusables[0] || elDrawer;",
		    "  if (target && target.focus) {",
		    "    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }",
		    "  }",
		    "}, true);",
	    "",
		    "elBoardSelect.addEventListener('change', () => {",
		    "  selectedBoardId = elBoardSelect.value;",
		    "  localStorage.setItem('kanban.selectedBoardId', selectedBoardId);",
		    "  render();",
	    "});",
	    "",
	    "if (elArchivedToggle) elArchivedToggle.addEventListener('click', () => {",
	    "  showArchivedCards = !showArchivedCards;",
	    "  localStorage.setItem('kanban.showArchivedCards', showArchivedCards ? '1' : '0');",
	    "  render();",
	    "});",
	    "",
	    "elRefresh.addEventListener('click', async () => {",
    "  try {",
    "    setStatus('ok', 'Refreshing...');",
    "    await refreshState();",
    "  } catch (e) {",
    "    setStatus('bad', e && e.message ? e.message : String(e));",
    "  }",
    "});",
    "",
    "elGitSync.addEventListener('click', async () => {",
    "  try {",
    "    setStatus('ok', 'Syncing...');",
    "    await postJson('/api/git/sync', {});",
    "    await refreshState();",
    "  } catch (e) {",
    "    setStatus('bad', e && e.message ? e.message : String(e));",
    "  }",
    "});",
    "",
	    "elNewBoard.addEventListener('click', async () => {",
	    "  openModal('newBoard', elNewBoard, {});",
	    "});",
	    "",
	    "elMembers.addEventListener('click', async () => {",
	    "  const boardId = ensureSelectedBoardId();",
	    "  if (!boardId) return;",
	    "  openModal('members', elMembers, { boardId });",
	    "});",
    "",
    "let searchTimer = null;",
    "let searchActiveIndex = -1;",
    "",
    "function isSearchOpen() {",
    "  return !!elSearchResults && elSearchResults.classList.contains('open');",
    "}",
    "",
    "function getSearchRows() {",
    "  if (!elSearchResults) return [];",
    "  return Array.from(elSearchResults.querySelectorAll('.item[data-card-id]'));",
    "}",
    "",
    "function setSearchActive(index, opts) {",
    "  const options = opts || {};",
    "  const rows = getSearchRows();",
    "  if (!rows.length) {",
    "    searchActiveIndex = -1;",
    "    elSearch.removeAttribute('aria-activedescendant');",
    "    return;",
    "  }",
    "  let next = Number.isFinite(index) ? index : -1;",
    "  if (next < 0) next = 0;",
    "  if (next >= rows.length) next = rows.length - 1;",
    "  if (searchActiveIndex === next) return;",
    "  const prev = searchActiveIndex;",
    "  searchActiveIndex = next;",
    "  if (prev >= 0 && rows[prev]) {",
    "    rows[prev].classList.remove('active');",
    "    rows[prev].setAttribute('aria-selected', 'false');",
    "  }",
    "  const row = rows[next];",
    "  row.classList.add('active');",
    "  row.setAttribute('aria-selected', 'true');",
    "  if (row.id) elSearch.setAttribute('aria-activedescendant', row.id);",
    "  if (!options.noScroll && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });",
    "}",
    "",
    "function openSearchRow(row) {",
    "  if (!row) return;",
    "  const boardId = row.getAttribute('data-board-id');",
    "  const cardId = row.getAttribute('data-card-id');",
    "  if (boardId) {",
    "    selectedBoardId = boardId;",
    "    localStorage.setItem('kanban.selectedBoardId', selectedBoardId);",
    "  }",
    "  closeSearch();",
    "  render();",
    "  setTimeout(() => openCard(cardId), 0);",
    "}",
    "function closeSearch() {",
    "  searchActiveIndex = -1;",
    "  elSearchResults.classList.remove('open');",
    "  elSearchResults.innerHTML = '';",
    "  elSearch.setAttribute('aria-expanded', 'false');",
    "  elSearch.removeAttribute('aria-activedescendant');",
    "}",
    "",
    "elSearch.addEventListener('keydown', (e) => {",
    "  if (!isSearchOpen()) {",
    "    if (e.key === 'Escape') { closeSearch(); }",
    "    return;",
    "  }",
    "  if (e.key === 'Escape') {",
    "    e.preventDefault();",
    "    e.stopPropagation();",
    "    closeSearch();",
    "    return;",
    "  }",
    "  if (e.key === 'ArrowDown') {",
    "    e.preventDefault();",
    "    setSearchActive(searchActiveIndex + 1);",
    "    return;",
    "  }",
    "  if (e.key === 'ArrowUp') {",
    "    e.preventDefault();",
    "    setSearchActive(searchActiveIndex - 1);",
    "    return;",
    "  }",
    "  if (e.key === 'Enter') {",
    "    const rows = getSearchRows();",
    "    if (!rows.length) return;",
    "    if (searchActiveIndex < 0) setSearchActive(0);",
    "    const row = rows[searchActiveIndex] || rows[0];",
    "    e.preventDefault();",
    "    openSearchRow(row);",
    "  }",
    "});",
    "",
    "elSearch.addEventListener('input', () => {",
    "  if (searchTimer) clearTimeout(searchTimer);",
    "  const q = elSearch.value.trim();",
    "  if (!q) return closeSearch();",
    "  searchTimer = setTimeout(async () => {",
    "    try {",
      "      const out = await getJson('/api/search?query=' + encodeURIComponent(q));",
      "      const items = out.results || [];",
      "      if (!items.length) {",
        '        elSearchResults.innerHTML = \'<div class="item"><div class="t muted">No matches</div></div>\';',
        "        elSearchResults.classList.add('open');",
        "        elSearch.setAttribute('aria-expanded', 'true');",
        "        return;",
      "      }",
      "      elSearchResults.innerHTML = items.slice(0, 20).map((it, idx) => `",
      '        <div id="searchItem-${idx}" class="item" role="option" aria-selected="false" data-idx="${idx}" data-card-id="${escapeHtml(it.cardId)}" data-board-id="${escapeHtml(it.boardId)}">',
      '          <div class="t">${escapeHtml(it.title)}</div>',
      '          <div class="m">${escapeHtml(it.boardId.slice(0, 8))} - ${escapeHtml(it.listId.slice(0, 8))}</div>',
      "        </div>`).join('');",
      "      elSearchResults.classList.add('open');",
      "      elSearch.setAttribute('aria-expanded', 'true');",
      "      searchActiveIndex = -1;",
      "      elSearch.removeAttribute('aria-activedescendant');",
      "      elSearchResults.querySelectorAll('.item[data-card-id]').forEach((row) => {",
      "        row.addEventListener('click', () => openSearchRow(row));",
      "        row.addEventListener('mouseenter', () => {",
      "          const idx = Number.parseInt(row.getAttribute('data-idx') || '-1', 10);",
      "          if (Number.isFinite(idx) && idx >= 0) setSearchActive(idx, { noScroll: true });",
      "        });",
      "      });",
      "      const rows = getSearchRows();",
      "      if (rows.length) setSearchActive(0, { noScroll: true });",
    "    } catch (e) {",
      '      elSearchResults.innerHTML = \'<div class="item"><div class="t">Error</div><div class="m">\' + escapeHtml(e && e.message ? e.message : String(e)) + \'</div></div>\';',
      "      elSearchResults.classList.add('open');",
      "      elSearch.setAttribute('aria-expanded', 'true');",
      "      searchActiveIndex = -1;",
      "      elSearch.removeAttribute('aria-activedescendant');",
    "    }",
    "  }, 180);",
    "});",
    "",
    "document.addEventListener('click', (e) => {",
    "  if (!e.target.closest('.search-wrap')) closeSearch();",
    "});",
    "",
    "function startStream() {",
    "  if (stream) {",
    "    try { stream.close(); } catch {}",
    "    stream = null;",
    "  }",
    "  try {",
    "    stream = new EventSource('/api/ops/stream?afterSeq=' + encodeURIComponent(String(appliedThroughSeq || 0)));",
    "    stream.addEventListener('ops', async () => {",
    "      try {",
    "        await refreshState();",
    "      } catch {",
    "        // ignore",
    "      }",
    "    });",
    "    stream.onerror = () => {",
    "      if (stream) stream.close();",
    "      stream = null;",
    "    };",
    "  } catch {",
    "    stream = null;",
    "  }",
    "}",
    "",
    "render();",
    "refreshGitStatus()",
    "  .then(() => setStatus('ok', 'Ready'))",
    "  .catch(() => setStatus('ok', 'Ready'));",
    "startStream();",
    "",
  ].join("\n");
}

function summarizeOp(args: {
  op: AnyOp;
  listNameById: Record<string, string | undefined>;
}): string {
  const { op, listNameById } = args;
  switch (op.type) {
    case "card.created": {
      const p = op.payload as { title: string; listId: string };
      return `Created in ${listNameById[p.listId] ?? p.listId}: ${p.title}`;
    }
    case "card.moved": {
      const p = op.payload as { fromListId: string; toListId: string };
      const from = listNameById[p.fromListId] ?? p.fromListId;
      const to = listNameById[p.toListId] ?? p.toListId;
      return `Moved from ${from} to ${to}`;
    }
    case "card.updated": {
      const p = op.payload as { title?: string; description?: string; dueDate?: string | null };
      const parts: string[] = [];
      if (typeof p.title === "string") parts.push("title");
      if (typeof p.description === "string") parts.push("description");
      if (typeof p.dueDate === "string" || p.dueDate === null) parts.push("due date");
      return parts.length > 0 ? `Updated ${parts.join(", ")}` : "Updated card";
    }
    case "card.archived": {
      const p = op.payload as { archived: boolean };
      return p.archived ? "Archived card" : "Restored card";
    }
    case "comment.added": {
      const p = op.payload as { text: string };
      const trimmed = String(p.text ?? "").trim();
      const short = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
      return short ? `Comment: ${short}` : "Comment added";
    }
    case "checklist.itemAdded": {
      const p = op.payload as { text: string };
      return `Checklist: added "${p.text}"`;
    }
    case "checklist.itemToggled": {
      const p = op.payload as { checked: boolean };
      return p.checked ? "Checklist: checked item" : "Checklist: unchecked item";
    }
    case "checklist.itemRenamed": {
      const p = op.payload as { text: string };
      return `Checklist: renamed to "${p.text}"`;
    }
    case "checklist.itemRemoved": {
      return "Checklist: removed item";
    }
    case "list.moved": {
      return "Reordered list";
    }
    default:
      return op.type;
  }
}

async function handleSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  args: WebArgs,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const afterSeqRaw = url.searchParams.get("afterSeq") ?? "0";
  const afterSeq = Number.parseInt(afterSeqRaw, 10);
  const safeAfterSeq = Number.isFinite(afterSeq) && afterSeq >= 0 ? afterSeq : 0;

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.write(`: ok\n\n`);

  const sub = await subscribeOps({
    repoPath: args.repoPath,
    afterSeq: safeAfterSeq,
    onOps: (ops) => {
      const maxSeq = ops.reduce((m, o) => Math.max(m, o.seq), safeAfterSeq);
      res.write(`event: ops\n`);
      res.write(`data: ${JSON.stringify({ maxSeq })}\n\n`);
    },
    persistent: false,
  });

  const ping = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 20_000);

  const cleanup = (): void => {
    clearInterval(ping);
    sub.close();
    res.end();
  };

  req.on("close", cleanup);
}

export function createWebServer(args: WebArgs): http.Server {
  return http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/") {
        const { state, appliedThroughSeq } = await rebuildState(args.repoPath);
        const html = renderPage({
          repoPath: args.repoPath,
          actorId: args.actorId,
          bootstrapJson: safeJsonForScript({ state, appliedThroughSeq }),
        });
        sendHtml(res, 200, html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/app.css") {
        sendText(res, 200, "text/css; charset=utf-8", renderAppCss());
        return;
      }

      if (req.method === "GET" && url.pathname === "/app.js") {
        sendText(res, 200, "application/javascript; charset=utf-8", renderAppJs());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const { state, appliedThroughSeq } = await rebuildState(args.repoPath);
        sendJson(res, 200, { ok: true, appliedThroughSeq, state });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/git/status") {
        const status = await (args.git?.status
          ? args.git.status(args.repoPath)
          : Promise.resolve({ dirty: false, porcelain: "" }));
        sendJson(res, 200, { ok: true, status });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/git/fetch") {
        if (args.git?.fetch) await args.git.fetch(args.repoPath);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/git/pull") {
        if (args.git?.pull) await args.git.pull(args.repoPath);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/git/push") {
        if (args.git?.push) await args.git.push(args.repoPath);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/git/sync") {
        if (args.git?.sync) await args.git.sync(args.repoPath);
        else {
          if (args.git?.fetch) await args.git.fetch(args.repoPath);
          if (args.git?.pull) await args.git.pull(args.repoPath);
          if (args.git?.push) await args.git.push(args.repoPath);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/search") {
        const query = url.searchParams.get("query") ?? "";
        const results = await searchCards(args.repoPath, query);
        sendJson(res, 200, { ok: true, results });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/cards/history") {
        const cardId = url.searchParams.get("cardId") as CardId | null;
        if (!cardId) {
          sendJson(res, 400, { ok: false, error: "Expected query: ?cardId=..." });
          return;
        }
        const ops = await loadOps(args.repoPath);
        const { state } = await rebuildState(args.repoPath);
        const listNameById: Record<string, string | undefined> = {};
        for (const list of Object.values(state.lists)) listNameById[list.id] = list.name;

        const items = ops
          .filter((op) => {
            switch (op.type) {
              case "card.created":
              case "card.moved":
              case "card.updated":
              case "card.archived":
              case "comment.added":
              case "checklist.itemAdded":
              case "checklist.itemToggled":
              case "checklist.itemRenamed":
              case "checklist.itemRemoved":
                return (op.payload as { cardId: string }).cardId === cardId;
              default:
                return false;
            }
          })
          .map((op) => ({
            ts: op.ts,
            actorId: op.actorId,
            type: op.type,
            summary: summarizeOp({ op, listNameById }),
          }));

        sendJson(res, 200, { ok: true, items });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ops/stream") {
        await handleSse(req, res, args);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/boards") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { name?: string };
        const name = body?.name?.trim();
        if (!name) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { name }" });
          return;
        }
        const boardId = await createBoard({
          repoPath: args.repoPath,
          name,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true, boardId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/lists") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { boardId?: BoardId; name?: string };
        const name = body?.name?.trim();
        if (!body?.boardId || !name) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { boardId, name }" });
          return;
        }
        const listId = await createList({
          repoPath: args.repoPath,
          boardId: body.boardId,
          name,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true, listId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/lists/move") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { listId?: ListId; position?: number };
        if (!body?.listId || typeof body.position !== "number") {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { listId, position }" });
          return;
        }
        await moveList({
          repoPath: args.repoPath,
          listId: body.listId,
          position: body.position,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/members/add") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { boardId?: BoardId; memberId?: string; role?: string };
        if (
          !body?.boardId ||
          !body?.memberId ||
          (body.role !== "viewer" && body.role !== "editor")
        ) {
          sendJson(res, 400, {
            ok: false,
            error: "Expected JSON: { boardId, memberId, role: 'viewer'|'editor' }",
          });
          return;
        }
        await addMember({
          repoPath: args.repoPath,
          boardId: body.boardId,
          memberId: body.memberId,
          role: body.role,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/members/role") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { boardId?: BoardId; memberId?: string; role?: string };
        if (
          !body?.boardId ||
          !body?.memberId ||
          (body.role !== "viewer" && body.role !== "editor")
        ) {
          sendJson(res, 400, {
            ok: false,
            error: "Expected JSON: { boardId, memberId, role: 'viewer'|'editor' }",
          });
          return;
        }
        await changeMemberRole({
          repoPath: args.repoPath,
          boardId: body.boardId,
          memberId: body.memberId,
          role: body.role,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { boardId?: BoardId; listId?: ListId; title?: string };
        const title = body?.title?.trim();
        if (!body?.boardId || !body?.listId || !title) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { boardId, listId, title }" });
          return;
        }
        const cardId = await createCard({
          repoPath: args.repoPath,
          boardId: body.boardId,
          listId: body.listId,
          title,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true, cardId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/update") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as {
          cardId?: CardId;
          title?: string;
          description?: string;
          dueDate?: string | null;
          labels?: string[];
        };
        if (!body?.cardId) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, ...fields }" });
          return;
        }
        await updateCard({
          repoPath: args.repoPath,
          cardId: body.cardId,
          title: typeof body.title === "string" ? body.title : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          dueDate:
            typeof body.dueDate === "string" || body.dueDate === null ? body.dueDate : undefined,
          labels: Array.isArray(body.labels) ? body.labels : undefined,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/archive") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; archived?: boolean };
        if (!body?.cardId || typeof body.archived !== "boolean") {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, archived }" });
          return;
        }
        await archiveCard({
          repoPath: args.repoPath,
          cardId: body.cardId,
          archived: body.archived,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/comments") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; text?: string };
        const text = body?.text?.trim();
        if (!body?.cardId || !text) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, text }" });
          return;
        }
        const commentId = await addComment({
          repoPath: args.repoPath,
          cardId: body.cardId,
          text,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true, commentId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/checklist/add") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; text?: string };
        const text = body?.text?.trim();
        if (!body?.cardId || !text) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, text }" });
          return;
        }
        const itemId = await addChecklistItem({
          repoPath: args.repoPath,
          cardId: body.cardId,
          text,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true, itemId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/checklist/toggle") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; itemId?: string; checked?: boolean };
        if (!body?.cardId || !body?.itemId || typeof body.checked !== "boolean") {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, itemId, checked }" });
          return;
        }
        await toggleChecklistItem({
          repoPath: args.repoPath,
          cardId: body.cardId,
          itemId: body.itemId,
          checked: body.checked,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/checklist/rename") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; itemId?: string; text?: string };
        const text = body?.text?.trim();
        if (!body?.cardId || !body?.itemId || !text) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, itemId, text }" });
          return;
        }
        await renameChecklistItem({
          repoPath: args.repoPath,
          cardId: body.cardId,
          itemId: body.itemId,
          text,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/checklist/remove") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; itemId?: string };
        if (!body?.cardId || !body?.itemId) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, itemId }" });
          return;
        }
        await removeChecklistItem({
          repoPath: args.repoPath,
          cardId: body.cardId,
          itemId: body.itemId,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/cards/move") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { cardId?: CardId; toListId?: ListId; position?: number };
        if (!body?.cardId || !body?.toListId) {
          sendJson(res, 400, { ok: false, error: "Expected JSON: { cardId, toListId }" });
          return;
        }
        await moveCard({
          repoPath: args.repoPath,
          cardId: body.cardId,
          toListId: body.toListId,
          position: typeof body.position === "number" ? body.position : undefined,
          actorId: args.actorId,
          git: args.git,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    })().catch((err) => {
      sendJson(res, 500, { ok: false, error: (err as Error).message });
    });
  });
}

export async function main(args: WebArgs): Promise<void> {
  await initRepo({ path: args.repoPath, git: args.git });
  const server = createWebServer(args);
  server.listen(args.port, () => {
    process.stdout.write(
      `web: http://localhost:${args.port} repo=${args.repoPath} actorId=${args.actorId}\n`,
    );
  });
}
