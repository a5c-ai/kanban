import * as vscode from "vscode";
import type { BoardId, State } from "@a5c-ai/kanban-sdk";
import { toErrorMessage } from "../errors";
import {
  createBoardViewMessageHandler,
  type BoardViewMessageHandlerDeps,
  type ExtensionToWebviewMessage,
  type GetActorId,
  type GetClient,
  type WebviewToExtensionMessage,
} from "./boardProtocol";

function nonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function renderHtml(ctx: vscode.ExtensionContext, webview: vscode.Webview): string {
  const n = nonce();
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "media", "boardView.css"),
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "media", "boardView.js"),
  );
  const domUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "media", "boardView", "dom.js"),
  );
  const focusUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "media", "boardView", "focus.js"),
  );
  const protocolUri = webview.asWebviewUri(
    vscode.Uri.joinPath(ctx.extensionUri, "media", "boardView", "protocol.js"),
  );

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'nonce-${n}'`,
    `script-src ${webview.cspSource} 'nonce-${n}'`,
  ].join("; ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link nonce="${n}" rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${n}" src="${domUri}"></script>
    <script nonce="${n}" src="${focusUri}"></script>
    <script nonce="${n}" src="${protocolUri}"></script>
    <script nonce="${n}" src="${jsUri}"></script>
  </body>
</html>`;
}

export class KanbanBoardWebviewController {
  private panel: vscode.WebviewPanel | undefined;
  private activeBoardId: BoardId | undefined;
  private handleMessage: ((msg: WebviewToExtensionMessage) => Promise<void>) | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getClientOrThrow: GetClient,
    private readonly getActorId: GetActorId,
    private readonly loadState: () => Promise<State>,
    private readonly onDidMutate: () => void,
  ) {}

  async open(boardId?: BoardId): Promise<void> {
    if (boardId) this.activeBoardId = boardId;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "kanbanBoard",
        "Kanban Board",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.handleMessage = undefined;
      });

      this.panel.webview.html = renderHtml(this.ctx, this.panel.webview);

      const deps: BoardViewMessageHandlerDeps = {
        getClientOrThrow: this.getClientOrThrow,
        getActorId: this.getActorId,
        loadState: this.loadState,
        onDidMutate: this.onDidMutate,
        postMessage: (msg) => {
          void this.panel?.webview.postMessage(msg);
        },
        executeCommand: async (command, ...args) => {
          await vscode.commands.executeCommand(command, ...args);
        },
      };
      this.handleMessage = createBoardViewMessageHandler(deps);

      this.panel.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
        void this.handleMessage?.(msg).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Kanban: ${message}`);
        });
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
    }

    await this.refresh(this.activeBoardId);
  }

  async refresh(activeBoardId?: BoardId): Promise<void> {
    if (!this.panel) return;
    const boardId = activeBoardId ?? this.activeBoardId;
    try {
      const state = await this.loadState();
      if (boardId && state?.boards?.[boardId]?.name) {
        this.panel.title = `Kanban: ${state.boards[boardId].name}`;
      } else {
        this.panel.title = "Kanban Board";
      }
      void this.panel.webview.postMessage({
        type: "state",
        state,
        activeBoardId: boardId,
      } satisfies ExtensionToWebviewMessage);
    } catch (error) {
      void this.panel.webview.postMessage({
        type: "toast",
        level: "error",
        message: `Failed to load state: ${toErrorMessage(error)}`,
      } satisfies ExtensionToWebviewMessage);
      void this.panel.webview.postMessage({
        type: "state",
        state: null,
        activeBoardId: boardId,
      } satisfies ExtensionToWebviewMessage);
    }
  }
}
