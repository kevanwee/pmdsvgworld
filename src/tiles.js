// ─── PMD Red/Blue Rescue Team GBA Tile Renderer ──────────────────────────────
// Pixel-accurate canvas-drawn tiles matching the PMD GBA aesthetic.
// Each tile is 24×24 px (standard GBA PMD dungeon tile size).
// Palette extracted from PMD Red Rescue Team screenshots.
//
// Creates a pre-rendered off-screen TileAtlas that TileMap uses for fast blitting.

import { TILE } from './config.js';

export const TILE_PX = 24;   // px per tile

// ─── Palette ─────────────────────────────────────────────────────────────────
const P = {
  // Grass
  G1: '#5CB038', G2: '#489028', G3: '#70C848', G4: '#3A7020',
  // Tall grass
  TG1: '#3C8828', TG2: '#2C6818', TG3: '#50A038',
  // Water
  W1: '#2868C0', W2: '#3878D0', W3: '#4890E0', W4: '#1848A0',
  // Sand
  S1: '#C8A850', S2: '#A88838', S3: '#E0C068', S4: '#907030',
  // Stone path
  PT1: '#B09860', PT2: '#887848', PT3: '#C8B070', PT4: '#706040',
  // Tree/bush
  T1: '#287018', T2: '#388828', T3: '#48A038', T4: '#205010', T5: '#60B848',
  // Stone circle (plaza)
  SC1: '#9890A0', SC2: '#787080', SC3: '#B0A8B8', SC4: '#605870',
  // Deep water
  DW1: '#1850A0', DW2: '#244898', DW3: '#2060B8',
  // Flowers
  FR: '#E83030', FY: '#F0D000', FS: '#48A038',
  // General dark/shadow
  BLK: '#000000', SHD: 'rgba(0,0,0,0.18)',
};

const T = TILE_PX;

// ─── Low-level drawing helpers ────────────────────────────────────────────────
function px(ctx, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Deterministic checkerboard noise for texture variety
function noise(x, y, sx, sy) {
  const n = Math.sin((sx + x) * 127.1 + (sy + y) * 311.7) * 43758.5;
  return n - Math.floor(n);
}

// ─── Individual tile drawing functions ───────────────────────────────────────
function drawGrass(ctx, ox, oy, sx, sy) {
  // Base
  ctx.fillStyle = P.G1; ctx.fillRect(ox, oy, T, T);
  // Top-edge shadow
  ctx.fillStyle = P.G4; ctx.fillRect(ox, oy, T, 1);
  ctx.fillStyle = P.G4; ctx.fillRect(ox, oy, 1, T);
  // Texture pixels
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const v = noise(x, y, sx, sy);
    if (v < 0.07)      { ctx.fillStyle = P.G4; ctx.fillRect(ox + x, oy + y, 1, 1); }
    else if (v > 0.88) { ctx.fillStyle = P.G3; ctx.fillRect(ox + x, oy + y, 1, 1); }
  }
  // Grass tufts (tiny 2-px vertical strokes)
  const tufts = [[2,2],[5,8],[9,4],[13,11],[17,6],[21,14],[4,17],[11,19],[19,20],[7,21]];
  for (const [tx, ty] of tufts) {
    if (ty + 2 > T - 1) continue;
    px(ctx, P.G3, ox + tx, oy + ty, 1, 2);
    px(ctx, P.G2, ox + tx, oy + ty + 2, 1, 1);
  }
}

function drawTallGrass(ctx, ox, oy, sx, sy) {
  ctx.fillStyle = P.TG1; ctx.fillRect(ox, oy, T, T);
  ctx.fillStyle = P.TG2; ctx.fillRect(ox, oy, T, 1); ctx.fillRect(ox, oy, 1, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const v = noise(x, y, sx + 500, sy + 500);
    if (v < 0.1) { ctx.fillStyle = P.TG2; ctx.fillRect(ox + x, oy + y, 1, 1); }
    else if (v > 0.82) { ctx.fillStyle = P.TG3; ctx.fillRect(ox + x, oy + y, 1, 1); }
  }
  // Denser tufts
  const tufts = [[1,1],[3,6],[6,2],[8,9],[11,4],[14,8],[16,2],[19,5],[22,9],[4,13],[9,16],[13,12],[18,15],[21,19],[2,20],[7,22]];
  for (const [tx, ty] of tufts) {
    if (ty + 3 > T - 1) continue;
    px(ctx, P.TG3, ox + tx, oy + ty, 1, 3);
    px(ctx, P.TG3, ox + tx - 1, oy + ty + 1, 1, 2);
    px(ctx, P.TG2, ox + tx, oy + ty + 3, 1, 1);
  }
}

function drawWater(ctx, ox, oy, sx, sy, deep = false) {
  const b = deep ? P.DW1 : P.W1;
  ctx.fillStyle = b; ctx.fillRect(ox, oy, T, T);
  // Horizontal highlight stripe
  ctx.fillStyle = deep ? P.DW3 : P.W3;
  ctx.fillRect(ox, oy + 6,  T, 1);
  ctx.fillRect(ox, oy + 14, T, 1);
  // Shimmer pixels
  const shimmer = [[4,4],[10,3],[17,5],[6,12],[13,11],[20,13],[3,20],[9,18],[16,19]];
  ctx.fillStyle = deep ? P.DW2 : P.W4;
  for (const [tx, ty] of shimmer) px(ctx, deep ? P.DW2 : P.W4, ox + tx, oy + ty, 2, 1);
  // Dark top edge
  ctx.fillStyle = deep ? P.W4 : P.DW1;
  ctx.fillRect(ox, oy, T, 1); ctx.fillRect(ox, oy, 1, T);
}

function drawSand(ctx, ox, oy, sx, sy) {
  ctx.fillStyle = P.S1; ctx.fillRect(ox, oy, T, T);
  ctx.fillStyle = P.S4; ctx.fillRect(ox, oy, T, 1); ctx.fillRect(ox, oy, 1, T);
  // Granular noise
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const v = noise(x, y, sx + 200, sy + 200);
    if (v < 0.06)      px(ctx, P.S4, ox + x, oy + y, 1, 1);
    else if (v > 0.90) px(ctx, P.S3, ox + x, oy + y, 1, 1);
  }
  // Wind ripple lines
  ctx.fillStyle = P.S2;
  for (let row = 4; row < T; row += 7) {
    for (let col = 2; col < T - 2; col += 3) {
      px(ctx, P.S2, ox + col, oy + row, 2, 1);
    }
  }
}

function drawPath(ctx, ox, oy, sx, sy) {
  ctx.fillStyle = P.PT3; ctx.fillRect(ox, oy, T, T);
  // Stone block grid
  const gridX = [0, 8, 16];
  const gridY = [0, 8, 16];
  ctx.fillStyle = P.PT4;
  for (const gx of gridX) ctx.fillRect(ox + gx, oy, 1, T);
  for (const gy of gridY) ctx.fillRect(ox, oy + gy, T, 1);
  // Inner lighter blocks
  ctx.fillStyle = P.PT1;
  for (const gx of gridX) for (const gy of gridY) {
    ctx.fillRect(ox + gx + 1, oy + gy + 1, 6, 6);
  }
  // Subtle variation
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const v = noise(x, y, sx + 400, sy + 400);
    if (v < 0.04) px(ctx, P.PT2, ox + x, oy + y, 1, 1);
    else if (v > 0.94) px(ctx, P.PT1, ox + x, oy + y, 1, 1);
  }
  // Shadow edge
  ctx.fillStyle = P.PT4; ctx.fillRect(ox, oy, T, 1); ctx.fillRect(ox, oy, 1, T);
}

function drawTree(ctx, ox, oy) {
  // Shadow at base
  ctx.fillStyle = P.T4; ctx.fillRect(ox + 3, oy + 18, T - 6, 5);
  // Trunk
  px(ctx, P.T4, ox + 10, oy + 16, 4, 5);
  // Outer dark bush ring
  ctx.fillStyle = P.T1;
  ctx.beginPath(); ctx.arc(ox + 12, oy + 10, 10, 0, Math.PI * 2); ctx.fill();
  // Mid green
  ctx.fillStyle = P.T2;
  ctx.beginPath(); ctx.arc(ox + 12, oy + 10, 8, 0, Math.PI * 2); ctx.fill();
  // Inner brighter
  ctx.fillStyle = P.T3;
  ctx.beginPath(); ctx.arc(ox + 11, oy + 9, 5, 0, Math.PI * 2); ctx.fill();
  // Highlight (top-left)
  ctx.fillStyle = P.T5;
  ctx.beginPath(); ctx.arc(ox + 9, oy + 7, 3, 0, Math.PI * 2); ctx.fill();
  // Top shadow line
  px(ctx, P.T4, ox, oy, T, 1);
}

function drawStoneCircle(ctx, ox, oy) {
  // Outer base
  ctx.fillStyle = P.SC2; ctx.fillRect(ox, oy, T, T);
  // Concentric ring pattern (alternating light/dark)
  const rings = [11, 8, 6, 4, 2];
  const ringColors = [P.SC1, P.SC3, P.SC2, P.SC1, P.SC3];
  for (let i = 0; i < rings.length; i++) {
    ctx.fillStyle = ringColors[i];
    ctx.beginPath();
    ctx.arc(ox + 12, oy + 12, rings[i], 0, Math.PI * 2);
    ctx.fill();
  }
  // Grout lines between ring segments
  ctx.fillStyle = P.SC4;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const x1 = 12 + Math.cos(angle) * 5;
    const y1 = 12 + Math.sin(angle) * 5;
    const x2 = 12 + Math.cos(angle) * 11;
    const y2 = 12 + Math.sin(angle) * 11;
    ctx.beginPath();
    ctx.moveTo(ox + x1, oy + y1);
    ctx.lineTo(ox + x2, oy + y2);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = P.SC4;
    ctx.stroke();
  }
  // Dark top-left shadow
  px(ctx, P.SC4, ox, oy, T, 1); px(ctx, P.SC4, ox, oy, 1, T);
}

function drawFlower(ctx, ox, oy, sx, sy, color) {
  drawGrass(ctx, ox, oy, sx, sy);
  const cx = ox + 10, cy = oy + 10;
  // Stem
  px(ctx, P.FS, cx,     cy + 2, 1, 4);
  px(ctx, P.FS, cx + 1, cy + 3, 1, 3);
  // Petals
  px(ctx, color, cx - 1, cy - 1, 3, 3);
  // Outer petals (lighter)
  ctx.fillStyle = color;
  px(ctx, color, cx,     cy - 2, 1, 1);
  px(ctx, color, cx - 2, cy,     1, 1);
  px(ctx, color, cx + 2, cy,     1, 1);
  px(ctx, color, cx,     cy + 1, 1, 1);
  // White centre
  px(ctx, '#FFFFFF', cx, cy, 1, 1);
}

// ─── TileAtlas ────────────────────────────────────────────────────────────────
// Builds a single off-screen canvas containing all tile types side by side.
// Layout: one column per tile type, all at TILE_PX × TILE_PX.

const ATLAS_ORDER = [
  TILE.DEEP_WATER, TILE.WATER, TILE.SAND, TILE.GRASS,
  TILE.TALL_GRASS, TILE.TREE, TILE.PATH,
  TILE.FLOWER_R, TILE.FLOWER_Y, TILE.STONE_CIRCLE,
];

export const ATLAS_COLS = ATLAS_ORDER.length;

export function buildTileAtlas() {
  const atlas = document.createElement('canvas');
  atlas.width  = ATLAS_COLS * T;
  atlas.height = T;
  const ctx    = atlas.getContext('2d');

  ATLAS_ORDER.forEach((tile, col) => {
    const ox = col * T;
    const sx = col * 100;   // pseudo-random seed per tile type
    const sy = col * 77;
    switch (tile) {
      case TILE.DEEP_WATER:   drawWater(ctx, ox, 0, sx, sy, true); break;
      case TILE.WATER:        drawWater(ctx, ox, 0, sx, sy, false); break;
      case TILE.SAND:         drawSand(ctx, ox, 0, sx, sy); break;
      case TILE.GRASS:        drawGrass(ctx, ox, 0, sx, sy); break;
      case TILE.TALL_GRASS:   drawTallGrass(ctx, ox, 0, sx, sy); break;
      case TILE.TREE:         drawTree(ctx, ox, 0); break;
      case TILE.PATH:         drawPath(ctx, ox, 0, sx, sy); break;
      case TILE.FLOWER_R:     drawFlower(ctx, ox, 0, sx, sy, P.FR); break;
      case TILE.FLOWER_Y:     drawFlower(ctx, ox, 0, sx, sy, P.FY); break;
      case TILE.STONE_CIRCLE: drawStoneCircle(ctx, ox, 0); break;
    }
  });

  return atlas;
}

// Map tile type → atlas column index
const ATLAS_COL_MAP = Object.fromEntries(ATLAS_ORDER.map((t, i) => [t, i]));
export function tileCol(tileType) { return ATLAS_COL_MAP[tileType] ?? 3; /* default grass */ }

// ─── Varied atlas ─────────────────────────────────────────────────────────────
// For natural-looking maps, we generate multiple variants of each tile with
// different noise seeds and blit one per map cell (based on tile position hash).
export const VARIANTS = 4;

export function buildVariedAtlas() {
  const atlas = document.createElement('canvas');
  atlas.width  = ATLAS_COLS * VARIANTS * T;
  atlas.height = T;
  const ctx    = atlas.getContext('2d');

  ATLAS_ORDER.forEach((tile, col) => {
    for (let v = 0; v < VARIANTS; v++) {
      const ox = (col * VARIANTS + v) * T;
      const sx = col * 100 + v * 1337;
      const sy = col * 77  + v * 919;
      switch (tile) {
        case TILE.DEEP_WATER:   drawWater(ctx, ox, 0, sx, sy, true); break;
        case TILE.WATER:        drawWater(ctx, ox, 0, sx, sy, false); break;
        case TILE.SAND:         drawSand(ctx, ox, 0, sx, sy); break;
        case TILE.GRASS:        drawGrass(ctx, ox, 0, sx, sy); break;
        case TILE.TALL_GRASS:   drawTallGrass(ctx, ox, 0, sx, sy); break;
        case TILE.TREE:         drawTree(ctx, ox, 0); break;
        case TILE.PATH:         drawPath(ctx, ox, 0, sx, sy); break;
        case TILE.FLOWER_R:     drawFlower(ctx, ox, 0, sx, sy, P.FR); break;
        case TILE.FLOWER_Y:     drawFlower(ctx, ox, 0, sx, sy, P.FY); break;
        case TILE.STONE_CIRCLE: drawStoneCircle(ctx, ox, 0); break;
      }
    }
  });

  return atlas;
}

export function tileAtlasX(tileType, tileMapX, tileMapY) {
  const col = ATLAS_COL_MAP[tileType] ?? 3;
  const variant = (Math.abs(tileMapX * 7 + tileMapY * 13)) % VARIANTS;
  return (col * VARIANTS + variant) * T;
}
