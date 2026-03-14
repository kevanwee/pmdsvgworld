import { fbm } from './noise.js';
import { TILE, TILE_WALKABLE, TILE_SIZE, MAP_W, MAP_H } from './config.js';
import { buildVariedAtlas, tileAtlasX, TILE_PX } from './tiles.js';

export class TileMap {
  constructor(seed = 42) {
    this.seed   = seed;
    this.tiles  = [];
    this._atlas = null;   // built lazily on first render
    this.generate();
  }

  generate() {
    const w = MAP_W, h = MAP_H;
    const scale = 0.09;

    // Build noise grid
    const raw = [];
    for (let y = 0; y < h; y++) {
      raw[y] = [];
      for (let x = 0; x < w; x++) {
        raw[y][x] = fbm(x * scale, y * scale, this.seed, 5, 0.5, 2.0);
      }
    }

    // Classify tiles
    this.tiles = [];
    for (let y = 0; y < h; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < w; x++) {
        const v  = raw[y][x];
        const v2 = fbm(x * scale * 1.6, y * scale * 1.6, this.seed + 999, 3);

        let tile;
        if      (v < 0.27)                  tile = TILE.DEEP_WATER;
        else if (v < 0.34)                  tile = TILE.WATER;
        else if (v < 0.39)                  tile = TILE.SAND;
        else if (v > 0.80 && v2 > 0.58)    tile = TILE.TREE;
        else if (v > 0.72)                  tile = TILE.TALL_GRASS;
        else {
          if      (v2 > 0.84) tile = TILE.FLOWER_R;
          else if (v2 > 0.78) tile = TILE.FLOWER_Y;
          else                tile = TILE.GRASS;
        }
        this.tiles[y][x] = tile;
      }
    }

    // Paths
    this._carvePath(w * 0.1, h * 0.5, w * 0.45, h * 0.25);
    this._carvePath(w * 0.45, h * 0.25, w * 0.55, h * 0.75);
    this._carvePath(w * 0.55, h * 0.75, w * 0.9, h * 0.5);
    this._carvePath(w * 0.1, h * 0.5, w * 0.55, h * 0.75);

    // Stone circle plaza at centre
    this._placeStoneCircle(Math.floor(w / 2), Math.floor(h / 2), 5);

    // Clear around plaza for meeting area
    this._clearArea(Math.floor(w / 2), Math.floor(h / 2), 8);
  }

  _carvePath(x0, y0, x1, y1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t  = i / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (this._inBounds(nx, ny)
          && this.tiles[ny][nx] !== TILE.DEEP_WATER
          && this.tiles[ny][nx] !== TILE.WATER) {
          this.tiles[ny][nx] = TILE.PATH;
        }
      }
    }
  }

  _placeStoneCircle(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const nx = cx + dx, ny = cy + dy;
        if (this._inBounds(nx, ny)) this.tiles[ny][nx] = TILE.STONE_CIRCLE;
      }
    }
  }

  _clearArea(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const nx = cx + dx, ny = cy + dy;
        if (this._inBounds(nx, ny) && this.tiles[ny][nx] !== TILE.STONE_CIRCLE) {
          this.tiles[ny][nx] = TILE.GRASS;
        }
      }
    }
  }

  _inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

  isWalkable(tx, ty) {
    if (!this._inBounds(tx, ty)) return false;
    return TILE_WALKABLE[this.tiles[ty][tx]] ?? false;
  }

  isWalkablePx(px, py) {
    return this.isWalkable(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  render(ctx) {
    // Build atlas on first render (requires browser canvas)
    if (!this._atlas) this._atlas = buildVariedAtlas();

    const atlas = this._atlas;
    const T     = TILE_SIZE;

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.tiles[y][x];
        const sx   = tileAtlasX(tile, x, y);  // atlas source x
        ctx.drawImage(atlas, sx, 0, TILE_PX, TILE_PX, x * T, y * T, T, T);
      }
    }
  }
}
