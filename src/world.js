import { TileMap } from './tilemap.js';
import { NPC } from './npc.js';
import { ParticleSystem } from './particles.js';
import { WORLD_POKEMON, TILE_SIZE, MAP_W, MAP_H, CANVAS_W, CANVAS_H } from './config.js';

// ─── World ────────────────────────────────────────────────────────────────────
// Manages the game loop, TileMap, NPC roster and particles.
// Designed to be mounted on a <canvas> element.

export class World {
  constructor(canvas, options = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.options = options;

    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;

    this.tileMap   = new TileMap(options.seed ?? 42);
    this.particles = new ParticleSystem();
    this.npcs      = [];

    this._lastTime = null;
    this._raf      = null;
    this._offscreenTiles = null;   // cached tilemap render

    this._spawnNPCs();
    this._cacheTiles();
  }

  // ── NPC spawn ─────────────────────────────────────────────────────────────
  _spawnNPCs() {
    const pokemonList = this.options.pokemon ?? WORLD_POKEMON;
    const margin = 3;   // tile margin from edge

    for (const def of pokemonList) {
      let tx, ty, attempts = 0;
      do {
        tx = margin + Math.floor(Math.random() * (MAP_W - margin * 2));
        ty = margin + Math.floor(Math.random() * (MAP_H - margin * 2));
        attempts++;
      } while (!this.tileMap.isWalkable(tx, ty) && attempts < 200);

      const x = (tx + 0.5) * TILE_SIZE;
      const y = (ty + 0.5) * TILE_SIZE;
      this.npcs.push(new NPC(def, x, y, this.tileMap));
    }
  }

  // ── Tile cache ────────────────────────────────────────────────────────────
  _cacheTiles() {
    const off = document.createElement('canvas');
    off.width  = CANVAS_W;
    off.height = CANVAS_H;
    this.tileMap.render(off.getContext('2d'));
    this._offscreenTiles = off;
  }

  // ── Loop control ──────────────────────────────────────────────────────────
  start() {
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _tick(timestamp) {
    if (this._lastTime === null) this._lastTime = timestamp;
    const dt = Math.min(timestamp - this._lastTime, 80);  // cap dt at 80ms
    this._lastTime = timestamp;

    this._update(dt);
    this._render();

    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  // ── Update ────────────────────────────────────────────────────────────────
  _update(dt) {
    this.particles.update(dt);
    for (const npc of this.npcs) {
      npc.update(dt, this.npcs, this.particles);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Tilemap (cached)
    ctx.drawImage(this._offscreenTiles, 0, 0);

    // Sort NPCs by Y position for correct depth order
    const sorted = [...this.npcs].sort((a, b) => a.y - b.y);
    for (const npc of sorted) npc.render(ctx);

    this.particles.render(ctx);

    // Vignette overlay
    this._renderVignette(ctx);
  }

  _renderVignette(ctx) {
    const grad = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.25,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}
