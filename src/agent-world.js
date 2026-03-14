import { TileMap } from './tilemap.js';
import { Agent } from './agent.js';
import { Dummy } from './dummy.js';
import { ParticleSystem } from './particles.js';
import { WORLD_POKEMON, POKEMON_DEFS, TILE_SIZE, MAP_W, MAP_H, CANVAS_W, CANVAS_H } from './config.js';

// ─── AgentWorld ───────────────────────────────────────────────────────────────
// Like World but specialised for the Claude-agent visualiser:
//   • Places a training Dummy at the centre
//   • Uses Agent NPCs that can be assigned work tasks
//   • Continuously assigns random tasks to idle agents
//   • Logs events to an activity feed
export class AgentWorld {
  constructor(canvas, logEl, options = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.logEl   = logEl;
    this.options = options;

    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;

    this.tileMap   = new TileMap(options.seed ?? 77);
    this.particles = new ParticleSystem();
    this.agents    = [];

    // Place dummy at map centre
    const cx = (MAP_W / 2) * TILE_SIZE;
    const cy = (MAP_H / 2) * TILE_SIZE;
    this.dummy = new Dummy(cx, cy);

    this._lastTime     = null;
    this._raf          = null;
    this._offscreenTiles = null;
    this._taskInterval = 0;

    // Sample task labels
    this._taskPool = [
      'Read file',   'Write code',  'Run tests',   'Search docs',
      'Fix bug',     'Refactor',    'Deploy',      'Review PR',
      'Grep codebase', 'Lint check', 'Type check',  'Build',
      'Debug error', 'Generate SVG','Fetch API',   'Parse JSON',
    ];

    this._spawnAgents(options);
    this._cacheTiles();
  }

  // ── Spawn agents ──────────────────────────────────────────────────────────
  _spawnAgents(options) {
    const agentDefs = options.agents ?? [
      { pokemon: POKEMON_DEFS.SHINY_GRENINJA,     name: 'Agent-1' },
      { pokemon: POKEMON_DEFS.SHINY_CERULEDGE,    name: 'Agent-2' },
      { pokemon: POKEMON_DEFS.SHINY_ARMAROUGE,    name: 'Agent-3' },
      { pokemon: POKEMON_DEFS.SHINY_IRON_VALIANT, name: 'Agent-4' },
      { pokemon: POKEMON_DEFS.MEGA_DIANCIE,        name: 'Orchestrator' },
      { pokemon: POKEMON_DEFS.SHINY_YVELTAL,       name: 'Agent-5' },
    ];

    const cx = (MAP_W / 2) * TILE_SIZE;
    const cy = (MAP_H / 2) * TILE_SIZE;
    const r  = 180;

    for (let i = 0; i < agentDefs.length; i++) {
      const def  = agentDefs[i];
      const angle = (Math.PI * 2 * i / agentDefs.length) - Math.PI / 2;
      let tx = cx + Math.cos(angle) * r;
      let ty = cy + Math.sin(angle) * r;

      // Snap to walkable tile
      let tileX = Math.floor(tx / TILE_SIZE);
      let tileY = Math.floor(ty / TILE_SIZE);
      if (!this.tileMap.isWalkable(tileX, tileY)) {
        // Search outward
        outer: for (let d = 1; d < 8; d++) {
          for (let dy = -d; dy <= d; dy++) {
            for (let dx = -d; dx <= d; dx++) {
              if (this.tileMap.isWalkable(tileX + dx, tileY + dy)) {
                tileX += dx; tileY += dy;
                break outer;
              }
            }
          }
        }
        tx = (tileX + 0.5) * TILE_SIZE;
        ty = (tileY + 0.5) * TILE_SIZE;
      }

      const agent = new Agent(def.pokemon, tx, ty, this.tileMap, { name: def.name });
      agent.dummy = this.dummy;
      this.agents.push(agent);
    }
  }

  _cacheTiles() {
    const off = document.createElement('canvas');
    off.width  = CANVAS_W;
    off.height = CANVAS_H;
    this.tileMap.render(off.getContext('2d'));
    this._offscreenTiles = off;
  }

  // ── Work distribution ─────────────────────────────────────────────────────
  dispatchWork(agentIndex, task) {
    const agent = this.agents[agentIndex % this.agents.length];
    if (!agent) return;
    agent.assignWork(task);
    this._log(`📋 ${agent.agentName}: "${task}"`);
  }

  dispatchToAll(tasks) {
    tasks.forEach((task, i) => this.dispatchWork(i, task));
  }

  _autoDispatch() {
    // Every few seconds, assign a random task to a random idle agent
    const idle = this.agents.filter(a => a.state === 'idle');
    if (idle.length === 0) return;
    const agent = idle[Math.floor(Math.random() * idle.length)];
    const task  = this._taskPool[Math.floor(Math.random() * this._taskPool.length)];
    agent.assignWork(task);
    this._log(`⚡ ${agent.agentName}: "${task}"`);
  }

  _log(msg) {
    if (!this.logEl) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.logEl.prepend(entry);
    // Keep last 30 entries
    while (this.logEl.children.length > 30) {
      this.logEl.removeChild(this.logEl.lastChild);
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  start() {
    this._raf = requestAnimationFrame(this._tick.bind(this));
    // Auto-dispatch every 3-6 seconds
    const schedule = () => {
      this._autoDispatch();
      setTimeout(schedule, 3000 + Math.random() * 3000);
    };
    setTimeout(schedule, 2000);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _tick(timestamp) {
    if (this._lastTime === null) this._lastTime = timestamp;
    const dt = Math.min(timestamp - this._lastTime, 80);
    this._lastTime = timestamp;
    this._update(dt);
    this._render();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  _update(dt) {
    this.dummy.update(dt);
    this.particles.update(dt);
    for (const agent of this.agents) {
      agent.update(dt, this.agents, this.particles);
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this._offscreenTiles, 0, 0);

    // Render dummy behind agents (centre mass)
    this.dummy.render(ctx);

    // Depth-sort agents
    const sorted = [...this.agents].sort((a, b) => a.y - b.y);
    for (const agent of sorted) agent.render(ctx);

    this.particles.render(ctx);
    this._renderHUD(ctx);
    this._renderVignette(ctx);
  }

  _renderHUD(ctx) {
    // Title bar
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, 28);
    ctx.font      = '11px "Press Start 2P", monospace';
    ctx.fillStyle = '#00ffaa';
    ctx.fillText('◆ CLAUDE AGENT VISUALIZER', 12, 18);

    // Agent status row
    ctx.font = '7px "Press Start 2P", monospace';
    this.agents.forEach((agent, i) => {
      const stateColor = {
        idle: '#aaa', walk: '#88f', sleep: '#88f',
        battle: '#f88', hurt: '#f55', work: '#ff0',
      }[agent.state] ?? '#fff';
      ctx.fillStyle = stateColor;
      ctx.fillText(`${agent.agentName}:${agent.state.toUpperCase()}`, 12 + i * 165, CANVAS_H - 10);
    });
    ctx.restore();
  }

  _renderVignette(ctx) {
    const grad = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.25,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,10,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}
