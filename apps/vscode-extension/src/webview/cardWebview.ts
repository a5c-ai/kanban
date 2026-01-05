import type { ActorId, Card, CardId, ChecklistItemId, State } from "@a5c-ai/kanban-sdk";
import * as vscode from "vscode";
import type { KanbanRepoClient } from "../kanbanRepo";

type CardPatch = {
  title?: string;
  description?: string;
  dueDate?: string | null;
  labels?: string[];
  archived?: boolean;
};

type CardHistoryEvent = {
  ts: string;
  actorId: ActorId;
  type: string;
  summary: string;
  seq: number;
  opId: string;
};

type GetClientOrThrow = () => { client: KanbanRepoClient };
type GetActorId = () => Promise<ActorId>;

function toCardPatch(patch: unknown): CardPatch {
  if (!patch || typeof patch !== "object") return {};
  const p = patch as Record<string, unknown>;
  const out: CardPatch = {};

  if (typeof p.title === "string") out.title = p.title;
  if (typeof p.description === "string") out.description = p.description;
  if (p.dueDate === null || typeof p.dueDate === "string") out.dueDate = p.dueDate;
  if (typeof p.archived === "boolean") out.archived = p.archived;
  if (Array.isArray(p.labels) && p.labels.every((x) => typeof x === "string"))
    out.labels = p.labels;

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

export function renderCardHtml(args: {
  card: Card;
  comments: State["commentsByCardId"][CardId];
  history: CardHistoryEvent[];
  conflictCount: number;
}): string {
  const { card } = args;
  const labels = Array.isArray(card.labels) ? card.labels.join(", ") : "";
  const dueDate = card.dueDate ?? "";
  const description = card.description ?? "";
  const checklist = Array.isArray(card.checklist) ? card.checklist : [];
  const comments = Array.isArray(args.comments) ? args.comments : [];
  const history = Array.isArray(args.history) ? args.history : [];

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; }
      .row { margin: 10px 0; }
      label { display: block; font-weight: 600; margin-bottom: 6px; }
      input[type="text"], textarea { width: 100%; box-sizing: border-box; padding: 8px; }
      textarea { min-height: 120px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .actions { display: flex; gap: 8px; margin-top: 12px; }
      button { padding: 8px 10px; cursor: pointer; }
      .muted { opacity: 0.8; font-size: 12px; }
      .banner { border: 1px solid rgba(127,127,127,0.35); border-left: 4px solid #d19a66; padding: 10px; border-radius: 10px; margin: 12px 0; }
      .checklist li { margin: 8px 0; display: flex; gap: 8px; align-items: center; }
      .checklist input[type="text"] { flex: 1; }
      .comment { border: 1px solid rgba(127,127,127,0.25); border-radius: 10px; padding: 10px; margin: 8px 0; }
      .history { border: 1px solid rgba(127,127,127,0.25); border-radius: 10px; padding: 10px; margin: 8px 0; }
    </style>
  </head>
  <body>
    <h2>${escapeHtml(card.title)}</h2>
    <div class="muted">cardId: ${escapeHtml(card.id)}</div>

    ${
      args.conflictCount > 0
        ? `<div class="banner"><strong>${args.conflictCount} conflicts</strong> detected in this repo. <button id="showConflicts">Show conflicts</button></div>`
        : ""
    }

    <div class="row">
      <label>Title</label>
      <input id="title" type="text" value="${escapeHtml(card.title)}" />
    </div>

    <div class="row">
      <label>Description</label>
      <textarea id="description">${escapeHtml(description)}</textarea>
    </div>

    <div class="row">
      <label>Due date (ISO or empty)</label>
      <input id="dueDate" type="text" value="${escapeHtml(dueDate)}" placeholder="2026-01-01T00:00:00.000Z" />
    </div>

    <div class="row">
      <label>Labels (comma-separated)</label>
      <input id="labels" type="text" value="${escapeHtml(labels)}" />
    </div>

    <div class="row">
      <label><input id="archived" type="checkbox" ${card.archived ? "checked" : ""} /> Archived</label>
    </div>

    <div class="row">
      <label>Checklist</label>
      <ul class="checklist">
        ${checklist
          .map(
            (it) =>
              `<li>
                <input type="checkbox" data-action="toggleChecklist" data-item-id="${escapeHtml(it.id)}" ${it.checked ? "checked" : ""}/>
                <input type="text" data-action="renameChecklist" data-item-id="${escapeHtml(it.id)}" value="${escapeHtml(it.text)}" />
                <button data-action="removeChecklist" data-item-id="${escapeHtml(it.id)}">Remove</button>
              </li>`,
          )
          .join("\n")}
      </ul>
      <div class="actions">
        <input id="newChecklistText" type="text" placeholder="Add checklist item..." />
        <button id="addChecklist">Add</button>
      </div>
    </div>

    <div class="row">
      <label>Comments</label>
      <div>
        ${comments
          .slice()
          .sort((a, b) => a.ts.localeCompare(b.ts))
          .map(
            (c) =>
              `<div class="comment"><div class="muted">${escapeHtml(c.ts)} • ${escapeHtml(c.actorId)}</div><div>${escapeHtml(c.text)}</div></div>`,
          )
          .join("\n")}
      </div>
      <textarea id="newComment" placeholder="Write a comment..."></textarea>
      <div class="actions">
        <button id="addComment">Add comment</button>
      </div>
    </div>

    <div class="row">
      <label>History</label>
      <div>
        ${
          history.length === 0
            ? `<div class="muted">No history.</div>`
            : history
                .slice()
                .sort((a, b) => a.seq - b.seq || a.opId.localeCompare(b.opId))
                .map(
                  (h) =>
                    `<div class="history"><div class="muted">${escapeHtml(h.ts)} • ${escapeHtml(
                      h.actorId,
                    )} • ${escapeHtml(h.type)}</div><div>${escapeHtml(h.summary)}</div></div>`,
                )
                .join("\n")
        }
      </div>
    </div>

    <div class="actions">
      <button id="save">Save</button>
      <button id="refresh">Refresh</button>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const qs = (sel) => document.querySelector(sel);
      document.getElementById('save').addEventListener('click', () => {
        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const dueDateRaw = document.getElementById('dueDate').value;
        const dueDate = dueDateRaw.trim().length === 0 ? null : dueDateRaw.trim();
        const labelsRaw = document.getElementById('labels').value;
        const labels = labelsRaw.split(',').map(s => s.trim()).filter(Boolean);
        const archived = document.getElementById('archived').checked;
        vscode.postMessage({ type: 'save', patch: { title, description, dueDate, labels, archived } });
      });
      document.getElementById('refresh').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });

      const showConflicts = qs('#showConflicts');
      if (showConflicts) showConflicts.addEventListener('click', () => vscode.postMessage({ type: 'showConflicts' }));

      document.getElementById('addChecklist').addEventListener('click', () => {
        const text = (document.getElementById('newChecklistText').value || '').trim();
        if (!text) return;
        document.getElementById('newChecklistText').value = '';
        vscode.postMessage({ type: 'addChecklist', text });
      });

      document.getElementById('addComment').addEventListener('click', () => {
        const text = (document.getElementById('newComment').value || '').trim();
        if (!text) return;
        document.getElementById('newComment').value = '';
        vscode.postMessage({ type: 'addComment', text });
      });

      document.querySelectorAll('[data-action=\"toggleChecklist\"]').forEach((el) => {
        el.addEventListener('change', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          vscode.postMessage({ type: 'toggleChecklist', itemId, checked: !!e.target.checked });
        });
      });
      document.querySelectorAll('[data-action=\"renameChecklist\"]').forEach((el) => {
        el.addEventListener('blur', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          const text = (e.target.value || '').trim();
          vscode.postMessage({ type: 'renameChecklist', itemId, text });
        });
      });
      document.querySelectorAll('[data-action=\"removeChecklist\"]').forEach((el) => {
        el.addEventListener('click', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          vscode.postMessage({ type: 'removeChecklist', itemId });
        });
      });
    </script>
  </body>
</html>`;
}

export class CardWebviewController {
  private readonly panelByCardId = new Map<CardId, vscode.WebviewPanel>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getClientOrThrow: GetClientOrThrow,
    private readonly getActorId: GetActorId,
    private readonly loadState: () => Promise<State>,
    private readonly onDidMutate: () => Promise<void>,
  ) {}

  async open(cardId: CardId): Promise<void> {
    const existing = this.panelByCardId.get(cardId);
    if (existing) {
      existing.reveal();
      await this.refresh(cardId);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "kanbanCard",
      "Kanban Card",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panelByCardId.set(cardId, panel);

    panel.onDidDispose(() => this.panelByCardId.delete(cardId));

    panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: unknown; patch?: unknown; text?: unknown; itemId?: unknown; checked?: unknown };

      if (m.type === "refresh") {
        await this.refresh(cardId);
        return;
      }
      if (m.type === "save") {
        await this.save(cardId, toCardPatch(m.patch));
        await this.refresh(cardId);
        await this.onDidMutate();
      }
      if (m.type === "showConflicts") {
        await vscode.commands.executeCommand("kanban.showConflicts");
      }
      if (m.type === "addChecklist" && typeof m.text === "string") {
        await this.addChecklistItem(cardId, m.text);
        await this.refresh(cardId);
        await this.onDidMutate();
      }
      if (m.type === "toggleChecklist" && typeof m.itemId === "string" && typeof m.checked === "boolean") {
        await this.toggleChecklistItem(cardId, m.itemId as ChecklistItemId, m.checked);
        await this.refresh(cardId);
        await this.onDidMutate();
      }
      if (m.type === "renameChecklist" && typeof m.itemId === "string" && typeof m.text === "string") {
        await this.renameChecklistItem(cardId, m.itemId as ChecklistItemId, m.text);
        await this.refresh(cardId);
        await this.onDidMutate();
      }
      if (m.type === "removeChecklist" && typeof m.itemId === "string") {
        await this.removeChecklistItem(cardId, m.itemId as ChecklistItemId);
        await this.refresh(cardId);
        await this.onDidMutate();
      }
      if (m.type === "addComment" && typeof m.text === "string") {
        await this.addComment(cardId, m.text);
        await this.refresh(cardId);
        await this.onDidMutate();
      }
    });

    await this.refresh(cardId);
  }

  private async save(cardId: CardId, patch: CardPatch): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    if (typeof patch.archived === "boolean") {
      await client.archiveCard(cardId, patch.archived, actorId);
    }
    await client.updateCard(
      cardId,
      {
        title: typeof patch.title === "string" ? patch.title : undefined,
        description: typeof patch.description === "string" ? patch.description : undefined,
        dueDate: typeof patch.dueDate === "string" || patch.dueDate === null ? patch.dueDate : undefined,
        labels: Array.isArray(patch.labels) ? patch.labels.map(String) : undefined,
      },
      actorId,
    );
  }

  private async addChecklistItem(cardId: CardId, text: string): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    await client.addChecklistItem(cardId, text, actorId);
  }

  private async toggleChecklistItem(cardId: CardId, itemId: ChecklistItemId, checked: boolean): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    await client.toggleChecklistItem(cardId, itemId, checked, actorId);
  }

  private async renameChecklistItem(cardId: CardId, itemId: ChecklistItemId, text: string): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    await client.renameChecklistItem(cardId, itemId, text, actorId);
  }

  private async removeChecklistItem(cardId: CardId, itemId: ChecklistItemId): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    await client.removeChecklistItem(cardId, itemId, actorId);
  }

  private async addComment(cardId: CardId, text: string): Promise<void> {
    const { client } = this.getClientOrThrow();
    const actorId = await this.getActorId();
    await client.ensureInitialized();
    await client.addComment(cardId, text, actorId);
  }

  async refresh(cardId: CardId): Promise<void> {
    const panel = this.panelByCardId.get(cardId);
    if (!panel) return;
    const state = await this.loadState();
    const card = state.cards[cardId];
    if (!card) {
      panel.webview.html = `<!doctype html><html><body>Card not found: ${cardId}</body></html>`;
      return;
    }
    const { client } = this.getClientOrThrow();
    await client.ensureInitialized();
    const history = (await client.getCardHistory(cardId)) as CardHistoryEvent[];
    panel.webview.html = renderCardHtml({
      card,
      comments: state.commentsByCardId[cardId] ?? [],
      history,
      conflictCount: state.conflicts.length,
    });
  }
}
