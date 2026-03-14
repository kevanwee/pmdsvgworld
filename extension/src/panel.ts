import * as vscode from 'vscode';
import * as path   from 'path';

// ─── Message types (extension ↔ webview) ──────────────────────────────────────
interface DispatchMsg   { type: 'dispatch';    agentIndex: number; task: string }
interface DispatchAllMsg{ type: 'dispatchAll'; task: string }
interface LogMsg        { type: 'log';         text: string }
interface ReadyMsg      { type: 'ready' }

type WebviewMsg = DispatchMsg | DispatchAllMsg;
type ExtensionMsg = LogMsg | ReadyMsg;

// ─── AgentWorldPanel ──────────────────────────────────────────────────────────
export class AgentWorldPanel {
  public static currentPanel: AgentWorldPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel        = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(
      () => { if (this._panel.visible) this._update(); },
      null,
      this._disposables,
    );

    // Messages from webview
    this._panel.webview.onDidReceiveMessage(
      (msg: ExtensionMsg) => {
        switch (msg.type) {
          case 'log':
            // Forward agent activity to VS Code output channel
            AgentWorldPanel._output?.appendLine(msg.text);
            break;
          case 'ready':
            vscode.window.setStatusBarMessage('$(check) PMD Agent World ready', 3000);
            break;
        }
      },
      null,
      this._disposables,
    );

    vscode.commands.executeCommand('setContext', 'pmdworld.panelOpen', true);
  }

  private static _output: vscode.OutputChannel | undefined;

  // ── Factory ──────────────────────────────────────────────────────────────
  public static createOrShow(extensionUri: vscode.Uri): AgentWorldPanel {
    if (!AgentWorldPanel._output) {
      AgentWorldPanel._output = vscode.window.createOutputChannel('PMD Agent World');
    }

    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AgentWorldPanel.currentPanel) {
      AgentWorldPanel.currentPanel._panel.reveal(column);
      return AgentWorldPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'pmdAgentWorld',
      '◆ PMD Agent World',
      column ?? vscode.ViewColumn.Beside,
      {
        enableScripts:        true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          // Extension's own files (dist/, media/)
          extensionUri,
          // Project root src/ (for loading the JS modules)
          vscode.Uri.joinPath(extensionUri, '..'),
        ],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');

    AgentWorldPanel.currentPanel = new AgentWorldPanel(panel, extensionUri);
    return AgentWorldPanel.currentPanel;
  }

  // ── Public dispatch API ───────────────────────────────────────────────────
  public dispatchTask(agentIndex: number, task: string): void {
    this._panel.webview.postMessage({ type: 'dispatch', agentIndex, task } satisfies DispatchMsg);
    AgentWorldPanel._output?.appendLine(`[Dispatch] Agent ${agentIndex === -1 ? 'random' : agentIndex}: "${task}"`);
  }

  public dispatchToAll(task: string): void {
    this._panel.webview.postMessage({ type: 'dispatchAll', task } satisfies DispatchAllMsg);
    AgentWorldPanel._output?.appendLine(`[Dispatch ALL] "${task}"`);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  private _update(): void {
    this._panel.title   = '◆ PMD Agent World';
    this._panel.webview.html = this._getHtml(this._panel.webview);
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    // URI helpers
    const uri = (rel: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, rel)).toString();

    // Project root src/ files (one level up from extension/)
    const srcUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, '..', 'src', file)).toString();

    const config     = srcUri('config.js');
    const noise      = srcUri('noise.js');
    const tilemap    = srcUri('tilemap.js');
    const sprite     = srcUri('sprite.js');
    const particles  = srcUri('particles.js');
    const npc        = srcUri('npc.js');
    const world      = srcUri('world.js');
    const dummy      = srcUri('dummy.js');
    const agent      = srcUri('agent.js');
    const agentWorld = srcUri('agent-world.js');
    const webviewJs  = uri('dist/webview.js');

    // Config values from VS Code settings
    const cfg          = vscode.workspace.getConfiguration('pmdworld');
    const seed         = cfg.get<number>('seed', 42);
    const autoDispatch = cfg.get<boolean>('autoDispatch', true);
    const interval     = cfg.get<number>('autoDispatchIntervalMs', 4000);

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      script-src 'nonce-${nonce}' ${webview.cspSource};
      style-src 'unsafe-inline';
      font-src https: ${webview.cspSource};
    "/>
  <title>PMD Agent World</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #050510;
      color: #eee;
      font-family: 'Press Start 2P', 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100vh;
      padding: 8px;
      gap: 8px;
      overflow: hidden;
    }
    h1 { font-size: 10px; color: #00ffaa; text-shadow: 0 0 10px #00ff88; }
    .layout { display: flex; gap: 10px; width: 100%; flex: 1; min-height: 0; }
    .canvas-wrap {
      flex: 1; border: 1px solid #1a3a2a;
      border-radius: 3px; overflow: hidden;
      box-shadow: 0 0 30px rgba(0,255,120,0.1);
      display: flex; align-items: center; justify-content: center;
    }
    canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    .sidebar { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .panel { background: #0d0d22; border: 1px solid #1a2a3a; border-radius: 3px; padding: 10px; }
    .panel h2 { font-size: 6px; color: #00ffaa; margin-bottom: 8px; border-bottom: 1px solid #1a2a3a; padding-bottom: 5px; }
    .log-feed { height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
    .log-entry { font-size: 6px; color: #7ac; line-height: 1.6; border-bottom: 1px solid #111; padding-bottom: 2px; }
    .status { display: flex; flex-direction: column; gap: 5px; }
    .agent-row { display: flex; align-items: center; gap: 6px; font-size: 6px; }
    .agent-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .agent-name { color: #aaa; flex: 1; }
    .agent-state { font-size: 5px; }
    input[type="text"] {
      font-family: inherit; font-size: 6px; background: #0a0a20;
      color: #aef; border: 1px solid #224; border-radius: 2px;
      padding: 4px; width: 100%; margin-top: 4px;
    }
    button {
      font-family: inherit; font-size: 6px; background: #0a1a0a;
      color: #00ffaa; border: 1px solid #0a4a2a; border-radius: 2px;
      padding: 5px; cursor: pointer; width: 100%; margin-top: 4px;
    }
    button:hover { background: #0a2a1a; }
  </style>
</head>
<body>
  <h1>◆ PMD AGENT WORLD</h1>

  <div class="layout">
    <div class="canvas-wrap"><canvas id="canvas"></canvas></div>

    <div class="sidebar">
      <div class="panel">
        <h2>⚡ AGENTS</h2>
        <div class="status" id="status"></div>
      </div>
      <div class="panel">
        <h2>📋 DISPATCH</h2>
        <input type="text" id="task-input" placeholder="Task label…" maxlength="30"/>
        <button id="btn-dispatch">⚡ Send to idle agent</button>
        <button id="btn-all">⚔ Send to all</button>
      </div>
      <div class="panel">
        <h2>📡 LOG</h2>
        <div class="log-feed" id="log"></div>
      </div>
    </div>
  </div>

  <!--
    Inline bootstrap: imports the project src/ modules via dynamic import
    using the webview URIs injected by the extension.
    The src/ import map is passed via a global object to avoid CORS issues
    with multiple <script type="module"> tags in webview context.
  -->
  <script nonce="${nonce}">
    window.PMD_SRC = {
      config:     '${config}',
      noise:      '${noise}',
      tilemap:    '${tilemap}',
      sprite:     '${sprite}',
      particles:  '${particles}',
      npc:        '${npc}',
      world:      '${world}',
      dummy:      '${dummy}',
      agent:      '${agent}',
      agentWorld: '${agentWorld}',
    };
    window.PMD_CONFIG = {
      seed:         ${seed},
      autoDispatch: ${autoDispatch},
      interval:     ${interval},
    };
  </script>
  <script nonce="${nonce}" src="${webviewJs}"></script>
</body>
</html>`;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  public dispose(): void {
    AgentWorldPanel.currentPanel = undefined;
    vscode.commands.executeCommand('setContext', 'pmdworld.panelOpen', false);
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
