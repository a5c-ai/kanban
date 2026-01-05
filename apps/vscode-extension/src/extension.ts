import * as vscode from "vscode";
import { newId, type ActorId, type BoardId, type CardId, type State } from "@a5c-ai/kanban-sdk";
import { createKanbanRepoClient } from "./kanbanRepo";
import { toErrorMessage } from "./errors";
import { resolveRepoPath } from "./repoPath";
import { buildRootNode, getChildren, type KanbanNode } from "./treeModel";
import { KanbanBoardViewProvider } from "./webview/boardView";
import { CardWebviewController } from "./webview/cardWebview";

type TreeContextValue = "kanbanRoot" | "kanbanBoard" | "kanbanList" | "kanbanCard";

class KanbanTreeProvider implements vscode.TreeDataProvider<KanbanNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<KanbanNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private lastStateError: string | undefined;

  constructor(private readonly loadState: () => Promise<State>) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: KanbanNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.kind === "card"
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = element.kind === "root" ? "root" : element.id;
    item.description = element.description;
    item.contextValue = this.contextValue(element);
    if (element.kind === "card") {
      item.command = { command: "kanban.openCard", title: "Open Card", arguments: [element.id] };
      if (element.archived) item.iconPath = new vscode.ThemeIcon("archive");
      else item.iconPath = new vscode.ThemeIcon("note");
    } else if (element.kind === "board") {
      item.iconPath = new vscode.ThemeIcon("project");
    } else if (element.kind === "list") {
      item.iconPath = new vscode.ThemeIcon("list-unordered");
    } else {
      item.iconPath = new vscode.ThemeIcon("root-folder");
    }
    return item;
  }

  async getChildren(element?: KanbanNode): Promise<KanbanNode[]> {
    try {
      const state = await this.loadState();
      this.lastStateError = undefined;
      const node = element ?? buildRootNode();
      return getChildren(state, node);
    } catch (error) {
      this.lastStateError = toErrorMessage(error);
      const placeholder: KanbanNode = {
        kind: "root",
        id: "root",
        label: "Kanban (not initialized)",
      };
      return element ? [] : [placeholder];
    }
  }

  private contextValue(node: KanbanNode): TreeContextValue {
    switch (node.kind) {
      case "root":
        return "kanbanRoot";
      case "board":
        return "kanbanBoard";
      case "list":
        return "kanbanList";
      case "card":
        return "kanbanCard";
    }
  }

  getLastError(): string | undefined {
    return this.lastStateError;
  }
}

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("kanban");
}

function getWorkspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

async function getActorId(ctx: vscode.ExtensionContext): Promise<ActorId> {
  const configured = (getConfig().get<string>("actorId") ?? "").trim();
  if (configured.length > 0) return configured as ActorId;

  const stored = ctx.globalState.get<string>("kanban.actorId");
  if (stored) return stored as ActorId;

  const generated = newId() as ActorId;
  await ctx.globalState.update("kanban.actorId", generated);
  return generated;
}

function getRepoClientOrThrow(): {
  repoPath: string;
  client: ReturnType<typeof createKanbanRepoClient>;
} {
  const repoPath = resolveRepoPath({
    configuredRepoPath: getConfig().get<string>("repoPath"),
    workspaceFolders: getWorkspaceFolderPaths(),
  });
  if (!repoPath) throw new Error("No repo path configured and no workspace folder is open.");
  return { repoPath, client: createKanbanRepoClient(repoPath) };
}

export function activate(ctx: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Kanban");
  ctx.subscriptions.push(output);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "kanban.showConflicts";
  ctx.subscriptions.push(status);

  const loadState = async () => {
    const { client } = getRepoClientOrThrow();
    await client.ensureInitialized();
    const state = await client.loadState();
    status.text =
      state.conflicts.length > 0 ? `Kanban: ${state.conflicts.length} conflicts` : "Kanban: OK";
    status.show();
    return state;
  };

  const treeProvider = new KanbanTreeProvider(loadState);
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider("kanbanExplorer", treeProvider));

  let boardViewProvider: KanbanBoardViewProvider | undefined;
  const refreshAll = async (): Promise<void> => {
    treeProvider.refresh();
    await boardViewProvider?.refresh();
  };

  boardViewProvider = new KanbanBoardViewProvider(
    ctx,
    getRepoClientOrThrow,
    async () => getActorId(ctx),
    loadState,
    () => {
      void refreshAll();
    },
  );
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("kanbanBoard", boardViewProvider));

  const cardWebview = new CardWebviewController(
    ctx,
    getRepoClientOrThrow,
    async () => getActorId(ctx),
    loadState,
    refreshAll,
  );

  async function runOrShowError<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      const msg = toErrorMessage(error);
      output.appendLine(msg);
      void vscode.window.showErrorMessage(`Kanban: ${msg}`);
      return undefined;
    }
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.refresh", async () => {
      await refreshAll();
      const err = treeProvider.getLastError();
      if (err) output.appendLine(err);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.selectRepo", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: "Select Kanban Repo Folder",
      });
      if (!picked?.[0]) return;
      await getConfig().update("repoPath", picked[0].fsPath, vscode.ConfigurationTarget.Workspace);
      await refreshAll();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.initRepo", async () => {
      await runOrShowError(async () => {
        const { client, repoPath } = getRepoClientOrThrow();
        await client.ensureInitialized();
        output.appendLine(`Initialized repo: ${repoPath}`);
        await refreshAll();
      });
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.createBoard", async () => {
      await runOrShowError(async () => {
        const name = await vscode.window.showInputBox({ prompt: "Board name" });
        if (!name) return;
        const { client } = getRepoClientOrThrow();
        const actorId = await getActorId(ctx);
        await client.ensureInitialized();
        await client.createBoard(name, actorId);
        await refreshAll();
      });
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "kanban.createList",
      async (boardIdOrNode?: BoardId | KanbanNode) => {
        await runOrShowError(async () => {
          const boardId = (
            typeof boardIdOrNode === "string"
              ? boardIdOrNode
              : boardIdOrNode?.kind === "board"
                ? boardIdOrNode.id
                : undefined
          ) as BoardId | undefined;
          if (!boardId) throw new Error("Select a board first.");
          const name = await vscode.window.showInputBox({ prompt: "List name" });
          if (!name) return;
          const { client } = getRepoClientOrThrow();
          const actorId = await getActorId(ctx);
          await client.ensureInitialized();
          await client.createList(boardId, name, actorId);
          await refreshAll();
        });
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.createCard", async (listNode?: KanbanNode) => {
      await runOrShowError(async () => {
        const listId = listNode?.kind === "list" ? listNode.id : undefined;
        const boardId = listNode?.kind === "list" ? listNode.boardId : undefined;
        if (!listId || !boardId) throw new Error("Select a list first.");
        const title = await vscode.window.showInputBox({ prompt: "Card title" });
        if (!title) return;
        const { client } = getRepoClientOrThrow();
        const actorId = await getActorId(ctx);
        await client.ensureInitialized();
        await client.createCard(boardId, listId, title, actorId);
        await refreshAll();
      });
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "kanban.openCard",
      async (cardIdOrNode?: CardId | KanbanNode) => {
        await runOrShowError(async () => {
          const cardId = (
            typeof cardIdOrNode === "string"
              ? cardIdOrNode
              : cardIdOrNode?.kind === "card"
                ? cardIdOrNode.id
                : undefined
          ) as CardId | undefined;
          if (!cardId) throw new Error("Select a card first.");
          await cardWebview.open(cardId);
        });
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.searchCards", async () => {
      await runOrShowError(async () => {
        const query = await vscode.window.showInputBox({ prompt: "Search cards" });
        if (query === undefined) return;
        const { client } = getRepoClientOrThrow();
        await client.ensureInitialized();
        const results = await client.searchCards(query);
        const picked = await vscode.window.showQuickPick(
          results.map((r) => ({ label: r.title, description: `${r.boardId} / ${r.listId}`, r })),
          { placeHolder: `${results.length} results` },
        );
        if (!picked) return;
        await cardWebview.open(picked.r.cardId);
      });
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("kanban.showConflicts", async () => {
      await runOrShowError(async () => {
        const state = await loadState();
        output.show(true);
        if (state.conflicts.length === 0) {
          output.appendLine("No conflicts.");
          return;
        }
        output.appendLine(`Conflicts: ${state.conflicts.length}`);
        for (const c of state.conflicts) {
          output.appendLine(
            `- ${c.entityType}:${c.entityId} field=${c.field} ops=${c.ops.length} seq=${c.seq}`,
          );
        }
      });
    }),
  );
}

export function deactivate(): void {}
