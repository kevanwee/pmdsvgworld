# PMD Pokemon Agent World — VS Code Extension

Visualize Claude AI agents as Pokemon in a Pokemon Mystery Dungeon-style world, directly inside VS Code.

## Features

- **Open Agent World** panel (`PMD: Open Agent World` command or status bar button)
- Each Pokemon represents a Claude agent with its own behaviour state machine
- **Working** → Pokemon walks to the training dummy and attacks it
- **Agent collision** → Two agents meeting triggers a battle sequence with spark effects
- **Dispatch tasks** from the Command Palette or the in-panel sidebar
- **Live activity log** inside the panel and VS Code output channel

## Usage

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run `PMD: Open Agent World`
3. The panel opens beside your active editor
4. Use `PMD: Dispatch Task` to send a task to a random idle agent
5. Use `PMD: Dispatch Task to All Agents` to dispatch to every agent simultaneously

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pmdworld.autoDispatch` | `true` | Auto-dispatch random tasks to idle agents |
| `pmdworld.autoDispatchIntervalMs` | `4000` | Interval between auto-dispatched tasks |
| `pmdworld.seed` | `42` | World generation seed |

## Building from source

```bash
cd extension
npm install
npm run bundle   # builds dist/extension.js + dist/webview.js
```

Press `F5` in VS Code to launch an Extension Development Host.

## Agents

| Pokemon | Role |
|---------|------|
| Shiny Greninja | Agent-1 |
| Shiny Ceruledge | Agent-2 |
| Shiny Armarouge | Agent-3 |
| Shiny Iron Valiant | Agent-4 |
| Mega Diancie | Orchestrator |
| Shiny Yveltal | Agent-5 |
