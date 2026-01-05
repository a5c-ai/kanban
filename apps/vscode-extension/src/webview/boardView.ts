import * as vscode from "vscode";
import type {
  BoardId,
  State,
} from "@a5c-ai/kanban-sdk";
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

export class KanbanBoardViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private handleMessage: ((msg: WebviewToExtensionMessage) => Promise<void>) | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getClientOrThrow: GetClient,
    private readonly getActorId: GetActorId,
    private readonly loadState: () => Promise<State>,
    private readonly onDidMutate: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };

    view.webview.html = this.renderHtml(view.webview);

    const deps: BoardViewMessageHandlerDeps = {
      getClientOrThrow: this.getClientOrThrow,
      getActorId: this.getActorId,
      loadState: this.loadState,
      onDidMutate: this.onDidMutate,
      postMessage: (msg) => {
        this.view?.webview.postMessage(msg);
      },
      executeCommand: async (command, ...args) => {
        await vscode.commands.executeCommand(command, ...args);
      },
    };
    this.handleMessage = createBoardViewMessageHandler(deps);

    view.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      void this.handleMessage?.(msg).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Kanban: ${message}`);
      });
    });
  }

  async refresh(activeBoardId?: BoardId): Promise<void> {
    if (!this.view) return;
    try {
      const state = await this.loadState();
      this.view.webview.postMessage({ type: "state", state, activeBoardId } satisfies ExtensionToWebviewMessage);
    } catch (error) {
      this.view.webview.postMessage({
        type: "toast",
        level: "error",
        message: `Failed to load state: ${toErrorMessage(error)}`,
      } satisfies ExtensionToWebviewMessage);
      this.view.webview.postMessage({ type: "state", state: null, activeBoardId } satisfies ExtensionToWebviewMessage);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const n = nonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "boardView.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "boardView.js"));
    const domUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "boardView", "dom.js"));
    const focusUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "boardView", "focus.js"),
    );
    const protocolUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "boardView", "protocol.js"),
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
}
