import { fbm } from './noise.js';
import { TILE, TILE_COLOR, TILE_WALKABLE, TILE_SIZE, MAP_W, MAP_H } from './config.js';

export class TileMap {
  constructor(seed = 42) {
    this.seed  = seed;
    this.tiles = [];
    this.generate();
  }

  generate() {
    const w = MAP_W, h = MAP_H;
    const scale = 0.07;   // zoom of the noise

    // Build raw noise grid
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
        const v2 = fbm(x * scale * 1.5, y * scale * 1.5, this.seed + 999, 3);

        let tile;
        if      (v < 0.28)                  tile = TILE.DEEP_WATER;
        else if (v < 0.35)                  tile = TILE.WATER;
        else if (v < 0.40)                  tile = TILE.SAND;
        else if (v > 0.78 && v2 > 0.55)    tile = TILE.TREE;
        else if (v > 0.70)                  tile = TILE.TALL_GRASS;
        else {
          // Sparse flowers on normal grass
          if (v2 > 0.82)      tile = TILE.FLOWER_R;
          else if (v2 > 0.76) tile = TILE.FLOWER_Y;
          else                tile = TILE.GRASS;
        }
        this.tiles[y][x] = tile;
      }
    }

    // Carve a winding path across the map (diagonal Z shape)
    this._carvePath(w * 0.1, h * 0.5, w * 0.45, h * 0.25);
    this._carvePath(w * 0.45, h * 0.25, w * 0.55, h * 0.75);
    this._carvePath(w * 0.55, h * 0.75, w * 0.9, h * 0.5);

    // Small clearing in the centre for NPC gathering
    this._clearArea(Math.floor(w / 2), Math.floor(h / 2), 6);
  }

  _carvePath(x0, y0, x1, y1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (this._inBounds(nx, ny) && this.tiles[ny][nx] !== TILE.DEEP_WATER
                                     && this.tiles[ny][nx] !== TILE.WATER) {
            this.tiles[ny][nx] = TILE.PATH;
          }
        }
      }
    }
  }

  _clearArea(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const nx = cx + dx, ny = cy + dy;
          if (this._inBounds(nx, ny)) this.tiles[ny][nx] = TILE.GRASS;
        }
      }
    }
  }

  _inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }

  isWalkable(tx, ty) {
    if (!this._inBounds(tx, ty)) return false;
    return TILE_WALKABLE[this.tiles[ty][tx]] ?? false;
  }

  isWalkablePx(px, py) {
    return this.isWalkable(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  render(ctx) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.tiles[y][x];
        const px   = x * TILE_SIZE;
        const py   = y * TILE_SIZE;

        ctx.fillStyle = TILE_COLOR[tile];
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        this._renderDetail(ctx, tile, px, py);
      }
    }
  }

  _renderDetail(ctx, tile, px, py) {
    const T = TILE_SIZE;
    switch (tile) {
      case TILE.WATER: {
        // Subtle highlight stripe
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px + 2, py + 3, T - 4, 2);
        break;
      }
      case TILE.DEEP_WATER: {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(px + 3, py + 5, T - 6, 2);
        break;
      }
      case TILE.GRASS: {
        // Tiny lighter speckles
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(px + 4, py + 3, 2, 2);
        ctx.fillRect(px + 10, py + 9, 2, 2);
        break;
      }
      case TILE.TALL_GRASS: {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(px, py, T, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(px + 2, py + 8, 3, 4);
        ctx.fillRect(px + 9, py + 4, 3, 4);
        break;
      }
      case TILE.TREE: {
        // Dark shadow + lighter canopy dot
        ctx.fillStyle = '#0d3b0d';
        ctx.fillRect(px, py + T - 4, T, 4);
        ctx.fillStyle = '#2d8b2d';
        ctx.beginPath();
        ctx.arc(px + T / 2, py + T / 2 - 1, T / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#55c455';
        ctx.beginPath();
        ctx.arc(px + T / 2 - 2, py + T / 2 - 3, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case TILE.PATH: {
        // Pebble dots
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(px + 3, py + 5,  2, 2);
        ctx.fillRect(px + 9, py + 11, 2, 2);
        ctx.fillRect(px + 12, py + 4, 2, 2);
        break;
      }
      case TILE.SAND: {
        ctx.fillStyle = 'rgba(200,160,60,0.25)';
        ctx.fillRect(px + 2, py + 2, 3, 1);
        ctx.fillRect(px + 10, py + 8, 2, 1);
        break;
      }
      case TILE.FLOWER_R: {
        // Grass base + red flower
        ctx.fillStyle = '#88cc44';
        ctx.fillRect(px + 5, py + 4, 4, 4);
        ctx.fillStyle = '#ff3030';
        ctx.fillRect(px + 6, py + 5, 2, 2);
        break;
      }
      case TILE.FLOWER_Y: {
        ctx.fillStyle = '#88cc44';
        ctx.fillRect(px + 5, py + 4, 4, 4);
        ctx.fillStyle = '#ffdd00';
        ctx.fillRect(px + 6, py + 5, 2, 2);
        break;
      }
    }
  }
}
