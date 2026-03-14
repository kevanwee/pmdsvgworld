// webview-entry.ts – runs in the VSCode WebviewPanel browser context.
//
// Because VSCode webviews cannot use ES-module dynamic imports from local
// file URIs (they get blocked by CSP even with the src allow-listed), we
// take a different approach:
//
//   1. The extension injects the webview-URI strings for each src/ module
//      into pmdWindow.PMD_SRC via an inline <script> before this bundle loads.
//   2. This bundle re-implements a minimal, self-contained version of the
//      AgentWorld using the same logic, so there are zero import dependencies
//      at runtime.
//
// This keeps the extension fully self-contained in its dist/ bundle while
// staying pixel-perfect to the canvas-based agent-world.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Webview globals ──────────────────────────────────────────────────────────
interface PmdWindow {
  PMD_SRC:    Record<string, string>;
  PMD_CONFIG: { seed: number; autoDispatch: boolean; interval: number };
  acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
  };
}
const pmdWindow = globalThis as unknown as PmdWindow & typeof globalThis;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  const vscode = pmdWindow.acquireVsCodeApi();

  const { CANVAS_W, CANVAS_H, TILE_SIZE, MAP_W, MAP_H, POKEMON_DEFS, WORLD_POKEMON,
          TILE, TILE_COLOR, TILE_WALKABLE, SCALE,
          DIR_S, DIR_SE, DIR_E, DIR_NE, DIR_N, DIR_NW, DIR_W, DIR_SW,
          IDLE_MIN, IDLE_MAX, WALK_MIN, WALK_MAX, SLEEP_MIN, SLEEP_MAX,
          BATTLE_DUR, HURT_DUR, BATTLE_RANGE, INTERACT_CHANCE,
        } = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.config) as any;

  const { fbm }         = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.noise)      as any;
  const { TileMap }     = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.tilemap)    as any;
  const { SpriteSet }   = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.sprite)     as any;
  const { ParticleSystem } = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.particles) as any;
  const { NPC, STATE }  = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.npc)        as any;
  const { Dummy }       = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.dummy)      as any;
  const { Agent }       = await import(/* @vite-ignore */ pmdWindow.PMD_SRC.agent)      as any;

  // ── World setup ───────────────────────────────────────────────────────────
  const cfg        = pmdWindow.PMD_CONFIG;
  const canvas     = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx        = canvas.getContext('2d')!;
  canvas.width     = CANVAS_W;
  canvas.height    = CANVAS_H;

  const tileMap    = new TileMap(cfg.seed);
  const particles  = new ParticleSystem();

  // Dummy at map centre
  const dummy      = new Dummy((MAP_W / 2) * TILE_SIZE, (MAP_H / 2) * TILE_SIZE);

  // Spawn agents in a ring
  const AGENT_DEFS = [
    { pokemon: POKEMON_DEFS.SHINY_GRENINJA,     name: 'Agent-1' },
    { pokemon: POKEMON_DEFS.SHINY_CERULEDGE,    name: 'Agent-2' },
    { pokemon: POKEMON_DEFS.SHINY_ARMAROUGE,    name: 'Agent-3' },
    { pokemon: POKEMON_DEFS.SHINY_IRON_VALIANT, name: 'Agent-4' },
    { pokemon: POKEMON_DEFS.MEGA_DIANCIE,       name: 'Orchestrator' },
    { pokemon: POKEMON_DEFS.SHINY_YVELTAL,      name: 'Agent-5' },
  ];

  const cx = (MAP_W / 2) * TILE_SIZE;
  const cy = (MAP_H / 2) * TILE_SIZE;
  const r  = 180;

  const agents: any[] = AGENT_DEFS.map((def, i) => {
    const angle = (Math.PI * 2 * i / AGENT_DEFS.length) - Math.PI / 2;
    let tx = Math.floor((cx + Math.cos(angle) * r) / TILE_SIZE);
    let ty = Math.floor((cy + Math.sin(angle) * r) / TILE_SIZE);
    for (let d = 0; d < 8 && !tileMap.isWalkable(tx, ty); d++) {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (tileMap.isWalkable(tx + dx, ty + dy)) { tx += dx; ty += dy; break; }
      }
    }
    const agent = new Agent(def.pokemon, (tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, tileMap, { name: def.name });
    agent.dummy = dummy;
    return agent;
  });

  // Cached tilemap
  const offscreen = document.createElement('canvas');
  offscreen.width  = CANVAS_W;
  offscreen.height = CANVAS_H;
  tileMap.render(offscreen.getContext('2d')!);

  // ── Game loop ─────────────────────────────────────────────────────────────
  let last: number | null = null;
  function tick(ts: number) {
    const dt = Math.min(last === null ? 0 : ts - last, 80);
    last = ts;

    dummy.update(dt);
    particles.update(dt);
    for (const agent of agents) agent.update(dt, agents, particles);

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(offscreen, 0, 0);
    dummy.render(ctx);
    [...agents].sort((a, b) => a.y - b.y).forEach(a => a.render(ctx));
    particles.render(ctx);

    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, 26);
    ctx.font = '10px "Courier New",monospace';
    ctx.fillStyle = '#00ffaa';
    ctx.fillText('◆ PMD AGENT WORLD  [VS Code]', 10, 17);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── Auto-dispatch ─────────────────────────────────────────────────────────
  const TASK_POOL = [
    'Read file', 'Write code', 'Run tests', 'Search docs',
    'Fix bug', 'Refactor', 'Deploy', 'Review PR',
    'Grep codebase', 'Lint check', 'Type check', 'Build',
  ];

  function autoDispatch() {
    const idle = agents.filter((a: any) => a.state === 'idle');
    if (idle.length > 0) {
      const agent = idle[Math.floor(Math.random() * idle.length)];
      const task  = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
      agent.assignWork(task);
      logEvent(`⚡ ${agent.agentName}: "${task}"`);
    }
  }

  if (cfg.autoDispatch) {
    const schedule = () => {
      autoDispatch();
      setTimeout(schedule, cfg.interval + Math.random() * 2000);
    };
    setTimeout(schedule, 2000);
  }

  // ── UI status ─────────────────────────────────────────────────────────────
  const statusEl = document.getElementById('status')!;
  AGENT_DEFS.forEach((def, i) => {
    const row  = document.createElement('div');
    row.className = 'agent-row';
    const dot  = document.createElement('div');
    dot.className = 'agent-dot';
    dot.style.background = def.pokemon.color;
    const name = document.createElement('span');
    name.className = 'agent-name';
    name.textContent = def.name;
    const state = document.createElement('span');
    state.className = 'agent-state';
    state.id        = `s${i}`;
    state.textContent = 'IDLE';
    row.append(dot, name, state);
    statusEl.append(row);
  });

  setInterval(() => {
    const colors: Record<string, string> = { idle:'#668', walk:'#88f', sleep:'#66a', battle:'#f88', hurt:'#f55', work:'#ff0' };
    agents.forEach((a: any, i: number) => {
      const el = document.getElementById(`s${i}`);
      if (el) { el.textContent = a.state.toUpperCase(); el.style.color = colors[a.state] ?? '#aaa'; }
    });
  }, 200);

  // ── Dispatch controls ─────────────────────────────────────────────────────
  document.getElementById('btn-dispatch')!.addEventListener('click', () => {
    const task = (document.getElementById('task-input') as HTMLInputElement).value.trim();
    if (!task) return;
    const idle = agents.filter((a: any) => a.state === 'idle');
    const pick = idle[Math.floor(Math.random() * idle.length)] ?? agents[0];
    pick.assignWork(task);
    logEvent(`⚡ ${pick.agentName}: "${task}"`);
    (document.getElementById('task-input') as HTMLInputElement).value = '';
  });

  document.getElementById('btn-all')!.addEventListener('click', () => {
    const task = (document.getElementById('task-input') as HTMLInputElement).value.trim();
    if (!task) return;
    agents.forEach((a: any) => a.assignWork(task));
    logEvent(`📡 ALL: "${task}"`);
    (document.getElementById('task-input') as HTMLInputElement).value = '';
  });

  document.getElementById('task-input')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-dispatch')!.click();
  });

  // ── Extension → webview messages ─────────────────────────────────────────
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;
    switch (msg.type) {
      case 'dispatch': {
        const target = msg.agentIndex === -1
          ? agents.filter((a: any) => a.state === 'idle')[0] ?? agents[0]
          : agents[msg.agentIndex];
        if (target) { target.assignWork(msg.task); logEvent(`⚡ ${target.agentName}: "${msg.task}"`); }
        break;
      }
      case 'dispatchAll':
        agents.forEach((a: any) => a.assignWork(msg.task));
        logEvent(`📡 ALL: "${msg.task}"`);
        break;
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function logEvent(text: string) {
    const logEl = document.getElementById('log')!;
    const entry = document.createElement('div');
    entry.className   = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logEl.prepend(entry);
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild!);
    vscode.postMessage({ type: 'log', text });
  }

  // Signal ready
  vscode.postMessage({ type: 'ready' });
})().catch(console.error);
