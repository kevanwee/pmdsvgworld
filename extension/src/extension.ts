import * as vscode from 'vscode';
import { AgentWorldPanel } from './panel';

let panel: AgentWorldPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // ── Commands ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('pmdworld.openAgentWorld', () => {
      panel = AgentWorldPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('pmdworld.dispatchTask', async () => {
      if (!panel) {
        vscode.window.showWarningMessage('PMD Agent World is not open. Run "PMD: Open Agent World" first.');
        return;
      }
      const task = await vscode.window.showInputBox({
        prompt:      'Task to dispatch to an agent',
        placeHolder: 'e.g. Read file, Write code, Run tests …',
      });
      if (task) panel.dispatchTask(-1, task);  // -1 = random idle agent
    }),

    vscode.commands.registerCommand('pmdworld.dispatchToAll', async () => {
      if (!panel) return;
      const task = await vscode.window.showInputBox({
        prompt:      'Task to dispatch to ALL agents',
        placeHolder: 'e.g. Deploy …',
      });
      if (task) panel.dispatchToAll(task);
    }),
  );

  // ── Status bar button ───────────────────────────────────────────────────────
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text    = '$(symbol-event) PMD World';
  statusItem.tooltip = 'Open PMD Pokemon Agent World';
  statusItem.command = 'pmdworld.openAgentWorld';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {
  panel?.dispose();
}
