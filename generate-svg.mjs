import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, basename } from 'path';
import { get } from 'https';
import { POKEMON_DEFS } from './src/config.js';

// ─── Sprite scale (applied to all sprite images, not tile size) ───────────────
const SPRITE_SCALE = 2;

// ─── Layout constants ─────────────────────────────────────────────────────────
const SVG_W   = 1280;
const SVG_H   = 480;         // must be exact multiple of TS (15*32=480)
const TS      = 32;          // tile px
const MAP_W   = Math.floor(SVG_W / TS);   // 40
const MAP_H   = Math.floor(SVG_H / TS);   // 15
const ROW_MIN = 0;
const ROW_MAX = MAP_H - 1;

// ─── Battle / movement timing ─────────────────────────────────────────────────
const STEP_DUR     = 0.20;    // seconds per tile
const PHASES       = [0.40, 0.60, 0.45, 0.55];
const PRE_DUR      = 0.20;
const POST_DUR     = 0.25;
const BATTLE_TOTAL = PRE_DUR + PHASES.reduce((a, b) => a + b, 0) + POST_DUR; // 2.45 s

// ─── Multi-round configuration ────────────────────────────────────────────────
// Total animation: ROUND_DUR * 2, loops forever via repeatCount="indefinite"
const ROUND_DUR = 30.0;      // seconds per round; all pokemon sleep here until next round
const TOTAL_DUR = ROUND_DUR * 2;

// Pokemon indices: 0=Diancie 1=Ceruledge 2=IronValiant 3=Greninja 4=Armarouge 5=Yveltal
// Fixed home room per pokemon (6×2 grid; row0=rooms 0-5, row1=rooms 6-11)
const PK_HOME = [0, 1, 5, 6, 11, 10];

const ROUNDS = [
  { pairs: [[0,2],[1,5],[3,4]], delays: [0, 0, 0],   walkTiles: [27, 32, 38] }, // R1: simultaneous
  { pairs: [[0,2],[1,4],[3,5]], delays: [0, 5, 10],  walkTiles: [27, 32, 38] }, // R2: staggered
];

const SEED    = 42;
const POKEMON = Object.values(POKEMON_DEFS);

// Tile type constants
const T = { WALL: 0, FLOOR: 1, CORR: 2, WATER: 3, STAIR: 5, ITEM: 6, TRAP: 7 };

// PMD EoS colour palette
const C = {
  bgDark:      '#12102A',
  wallInner:   '#1C1838',
  wallFace:    '#302660',
  floorGrout:  '#3C4272',
  floorFill:   '#5A6494',
  floorHi:     '#7888B2',
  floorSh:     '#484E7E',
  corrGrout:   '#323060',
  corrFill:    '#485080',
  corrHi:      '#586090',
  waterFill:   '#1A54C8',
  waterShine:  '#4080F0',
  stairFill:   '#7A5C1C',
  stairHi:     '#B88A30',
  itemOrb:     '#FFD040',
  itemStroke:  '#B89020',
  trapFill:    'rgba(180,0,0,0.92)',
};

// ─── RNG ──────────────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0x100000000; };
}
const rng = makeRng(SEED * 31337);
const ri  = (lo, hi) => Math.floor(rng() * (hi - lo)) + lo;
const f1  = n => n.toFixed(1);
const f5  = n => n.toFixed(5);

// ─── HTTP download ────────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((res, rej) => {
    get(url, r => {
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode} ${url}`));
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej);
  });
}

// ─── Tileset SVG pattern (crops a 24×24 source tile, scaled to TS×TS) ────────
function tilePattern(id, uri, srcX, srcY) {
  const scale = TS / 24;
  return `<pattern id="${id}" x="0" y="0" width="${TS}" height="${TS}" patternUnits="userSpaceOnUse">
  <image href="${uri}" x="${-srcX * scale}" y="${-srcY * scale}" width="${432 * scale}" height="${192 * scale}" image-rendering="pixelated"/>
</pattern>`;
}

// ─── Sprite helpers ───────────────────────────────────────────────────────────
function pngSize(fp) {
  const b = readFileSync(fp);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function parseAnim(pngPath, animName) {
  let dir = dirname(pngPath);
  for (let i = 0; i < 5; i++) {
    const xp = join(dir, 'AnimData.xml');
    if (existsSync(xp)) {
      const xml = readFileSync(xp, 'utf8');
      const m = xml.match(new RegExp(
        `<Name>${animName}<\\/Name>[\\s\\S]*?<FrameWidth>(\\d+)<\\/FrameWidth>` +
        `[\\s\\S]*?<FrameHeight>(\\d+)<\\/FrameHeight>[\\s\\S]*?<Durations>([\\s\\S]*?)<\\/Durations>`
      ));
      if (m) {
        const durs = [...m[3].matchAll(/<Duration>(\d+)<\/Duration>/g)];
        return { frameW: +m[1], frameH: +m[2], frameCount: durs.length,
                 durSec: durs.reduce((s, d) => s + +d[1], 0) / 60 };
      }
    }
    const p = dirname(dir); if (p === dir) break; dir = p;
  }
  return null;
}

// Derive XML animation name from filename e.g. 'QuickStrike-Anim.png' -> 'QuickStrike'
function animNameFromFile(filePath) {
  return basename(filePath).replace('-Anim.png', '');
}

// PMD sprite-sheet row: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW
function dirRow(dx, dy) {
  if (!dx && !dy) return 0;
  return [2, 1, 0, 7, 6, 5, 4, 3][Math.round((Math.atan2(dy, dx) / (Math.PI / 4) + 8)) % 8];
}

// ─── Dungeon generator — more open, 2-wide corridors, cross-connections ───────
function generateDungeon() {
  const W = MAP_W, H = MAP_H;
  const grid = Array.from({ length: H }, () => new Uint8Array(W));

  const COLS = 6, ROWS = 2;
  const secW = Math.floor(W / COLS);                          // 6
  const secH = Math.floor((ROW_MAX - ROW_MIN + 1) / ROWS);   // 4
  const rooms = [];

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const sx = rx * secW, sy = ROW_MIN + ry * secH;
      const rw = ri(3, Math.min(secW, W - sx - 1));
      const rh = ri(2, Math.min(secH + 1, ROW_MAX - sy));
      const ox = sx + ri(0, Math.max(1, secW - rw));
      const oy = sy + ri(0, Math.max(1, secH - rh));
      for (let y = oy; y < oy + rh && y < H; y++)
        for (let x = ox; x < ox + rw && x < W; x++)
          grid[y][x] = T.FLOOR;
      rooms.push({ x: ox, y: oy, w: rw, h: rh, cx: ox + (rw >> 1), cy: oy + (rh >> 1) });
    }
  }

  // 2-tile-wide L-shaped corridor
  function carve(ax, ay, bx, by) {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      if (grid[ay]?.[x] === T.WALL) grid[ay][x] = T.CORR;
      if (ay > ROW_MIN && grid[ay - 1]?.[x] === T.WALL) grid[ay - 1][x] = T.CORR;
    }
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      if (grid[y]?.[bx] === T.WALL) grid[y][bx] = T.CORR;
      if (bx + 1 < W && grid[y]?.[bx + 1] === T.WALL) grid[y][bx + 1] = T.CORR;
    }
  }

  // Connect all horizontally and vertically adjacent room pairs
  for (let ry = 0; ry < ROWS; ry++) for (let rx = 0; rx < COLS; rx++) {
    const c = rooms[ry * COLS + rx];
    if (rx + 1 < COLS) { const r = rooms[ry * COLS + rx + 1]; carve(c.cx, c.cy, r.cx, r.cy); }
    if (ry + 1 < ROWS) { const d = rooms[(ry + 1) * COLS + rx]; carve(c.cx, c.cy, d.cx, d.cy); }
  }

  // Extra diagonal cross-connections for richer path network
  for (let ry = 0; ry < ROWS - 1; ry++) for (let rx = 0; rx < COLS - 1; rx++) {
    if (rng() < 0.65) {
      const a = rooms[ry * COLS + rx], b = rooms[(ry + 1) * COLS + rx + 1];
      carve(a.cx, a.cy, b.cx, b.cy);
    }
    if (rng() < 0.45) {
      const a = rooms[ry * COLS + rx + 1], b = rooms[(ry + 1) * COLS + rx];
      carve(a.cx, a.cy, b.cx, b.cy);
    }
  }

  // Water in 1 random room
  const wr = rooms[ri(0, rooms.length)];
  for (let y = wr.y + 1; y < wr.y + wr.h - 1 && y < H; y++)
    for (let x = wr.x + 1; x < wr.x + wr.w - 1 && x < W; x++)
      if (grid[y][x] === T.FLOOR) grid[y][x] = T.WATER;

  // Cave erosion: soften wall corners for organic dungeon look (2 passes)
  for (let iter = 0; iter < 2; iter++) {
    const next = grid.map(r => Uint8Array.from(r));
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (grid[y][x] !== T.WALL) continue;
        let open = 0;
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]])
          if (grid[y+dy]?.[x+dx] !== T.WALL) open++;
        if (open >= 3) next[y][x] = T.FLOOR;
        else if (open >= 2 && rng() < 0.35) next[y][x] = T.FLOOR;
      }
    }
    for (let y = 0; y < H; y++) grid[y].set(next[y]);
  }

  return { grid, rooms, W, H };
}

// ─── Weighted Dijkstra — avoids tiles used by earlier pairs ───────────────────
function dijkstraPath(grid, W, H, sx, sy, ex, ey, avoidTiles, hardBlocks = new Set()) {
  const AVOID_COST = 9999;
  const ok = (x, y) => x >= 0 && x < W && y >= 0 && y < H && grid[y][x] !== T.WALL && !hardBlocks.has(`${x},${y}`);
  if (!ok(sx, sy) || !ok(ex, ey)) return [{ x: sx, y: sy }, { x: ex, y: ey }];

  const INF = 1e9;
  const dist = new Array(W * H).fill(INF);
  const prev = new Array(W * H).fill(-1);
  dist[sy * W + sx] = 0;
  const pq = [[0, sy * W + sx]];
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, idx] = pq.shift();
    if (d > dist[idx]) continue;
    if (idx === ey * W + ex) break;
    const cx = idx % W, cy = (idx / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!ok(nx, ny)) continue;
      const ni = ny * W + nx;
      const nd = d + 1 + (avoidTiles.has(`${nx},${ny}`) ? AVOID_COST : 0);
      if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = idx; pq.push([nd, ni]); }

    }
  }

  const path = [];
  let cur = ey * W + ex;
  while (cur !== -1) { path.push({ x: cur % W, y: (cur / W) | 0 }); cur = prev[cur]; }
  return path.reverse();
}

// ─── Per-tile inline rendering ───────────────────────────────────────────────
// gx/gy/grid are used when ts=true for neighbour-aware pattern selection
function renderTile(tx, ty, type, ts = false, gx = 0, gy = 0, grid = null) {
  const r = (x, y, w, h, c, extra = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`;
  const h4 = (gx * 7 + gy * 13) % 4;
  const h3 = (gx * 7 + gy * 13) % 3;

  switch (type) {
    case T.WALL: {
      if (ts) {
        // Neighbour-aware: wall directly above open floor uses edge variant
        const southOpen = grid?.[gy + 1]?.[gx] !== T.WALL && grid?.[gy + 1]?.[gx] !== undefined;
        const pat = southOpen ? `url(#patWallEdge${h4 % 2})` : `url(#patWall${h4})`;
        return r(tx, ty, TS, TS, pat);
      }
      return r(tx, ty, TS, TS, C.bgDark) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.wallInner);
    }

    case T.FLOOR:
      if (ts) return r(tx, ty, TS, TS, `url(#patFloor${h3})`);
      return r(tx, ty, TS, TS, C.floorGrout) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.floorFill) +
             r(tx + 1,   ty + 1,   TS - 2, 1,      C.floorHi) +
             r(tx + 1,   ty + 1,   1,      TS - 3, C.floorHi) +
             r(tx + 1,   ty+TS-2,  TS - 2, 1,      C.floorSh) +
             r(tx+TS-2,  ty + 2,   1,      TS - 3, C.floorSh);

    case T.CORR:
      if (ts) return r(tx, ty, TS, TS, `url(#patCorr${h3 % 2})`);
      return r(tx, ty, TS, TS, C.corrGrout) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.corrFill) +
             r(tx + 1, ty + 1, TS - 2, 1, C.corrHi) +
             r(tx + 1, ty + 1, 1,      TS - 3, C.corrHi);

    case T.WATER:
      return r(tx, ty, TS, TS, ts ? 'url(#patWater)' : C.waterFill) +
             r(tx, ty + Math.round(TS * 0.28), TS, 2, C.waterShine, ' opacity="0.6"') +
             r(tx, ty + Math.round(TS * 0.64), TS, 2, C.waterShine, ' opacity="0.6"');

    default: return '';
  }
}

// ─── Colored crystal decorations on wall tiles near floors ───────────────────
function crystalDecorations(grid, W, H) {
  const crng = makeRng(SEED * 9999);
  const out = [];
  const COLORS = ['#44FF88','#22CC66','#FF66CC','#FF44AA','#88FFCC','#AAFFEE'];
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      if (grid[gy][gx] !== T.WALL) continue;
      let nearOpen = false;
      for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]])
        if (grid[gy+dy]?.[gx+dx] !== T.WALL && grid[gy+dy]?.[gx+dx] !== undefined) nearOpen = true;
      if (!nearOpen || crng() > 0.22) continue;
      // Place 1-2 crystals per qualifying wall tile
      const count = crng() < 0.35 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const color = COLORS[Math.floor(crng() * COLORS.length)];
        const cx = gx * TS + 3 + crng() * (TS - 6);
        const cy = gy * TS + 3 + crng() * (TS - 6);
        const h  = 4 + crng() * 7;
        const w  = 1.5 + crng() * 2.5;
        const op = (0.55 + crng() * 0.45).toFixed(2);
        out.push(
          `<polygon points="${cx.toFixed(1)},${(cy-h).toFixed(1)} ${(cx+w).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy+h*0.25).toFixed(1)} ${(cx-w).toFixed(1)},${cy.toFixed(1)}" fill="${color}" opacity="${op}"/>`
        );
      }
    }
  }
  return out.join('');
}

function dungeonToSVG(grid, W, H, ts = false) {
  const tiles = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      tiles.push(renderTile(x * TS, y * TS, grid[y][x], ts, x, y, grid));

  const depth = [];
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] === T.WALL && grid[y - 1][x] !== T.WALL)
      depth.push(`<rect x="${x*TS}" y="${y*TS}" width="${TS}" height="4" fill="${C.wallFace}"/>`);
    if (grid[y][x] !== T.WALL && grid[y + 1]?.[x] === T.WALL)
      depth.push(`<rect x="${x*TS}" y="${(y+1)*TS}" width="${TS}" height="3" fill="rgba(0,0,0,0.45)"/>`);
  }
  return tiles.join('') + (ts ? '' : depth.join(''));
}

function waterAnimSVG(grid, W, H) {
  const lines = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] !== T.WATER) continue;
    const delay = ((x * 3 + y * 7) % 17) * 0.13;
    const cy = f1((y + 0.43) * TS);
    lines.push(`<line x1="${f1((x+0.15)*TS)}" y1="${cy}" x2="${f1((x+0.85)*TS)}" y2="${cy}" stroke="white" stroke-width="0.9" class="wsh" style="animation-delay:${delay.toFixed(2)}s"/>`);
  }
  return lines.join('');
}

// ─── Build paths for one round — independent collision avoidance per round ────
function buildRoundPaths(roundDef, rooms, grid, W, H) {
  const avoidTiles = new Set();
  const hardBlocks = new Set();

  return roundDef.pairs.map((pair, pi) => {
    const [pkA, pkB] = pair;
    const rA = rooms[PK_HOME[pkA]], rB = rooms[PK_HOME[pkB]];
    const wt = roundDef.walkTiles[pi];
    const delay = roundDef.delays[pi];

    const full = dijkstraPath(grid, W, H, rA.cx, rA.cy, rB.cx, rB.cy, avoidTiles, hardBlocks);
    const m = Math.max(1, (full.length - 1) >> 1);

    let pathA = full.slice(0, m + 1);
    let pathB = full.slice(m + 1).reverse();
    if (pathB.length < 2) pathB = [{ ...full[full.length - 1] }, { ...full[full.length - 1] }];

    const norm = path => {
      while (path.length < wt + 1) path.unshift({ ...path[0] });
      return path.length > wt + 1 ? path.slice(path.length - (wt + 1)) : path;
    };
    pathA = norm(pathA);
    pathB = norm(pathB);

    pathA.forEach(p => avoidTiles.add(`${p.x},${p.y}`));
    pathB.forEach(p => avoidTiles.add(`${p.x},${p.y}`));
    hardBlocks.add(`${pathA[0].x},${pathA[0].y}`);
    hardBlocks.add(`${pathB[0].x},${pathB[0].y}`);

    const eA = pathA[wt], eB = pathB[wt];
    const wDur = wt * STEP_DUR;
    return {
      pkA, pkB, pathA, pathB, eA, eB, wt, wDur, delay,
      avgYA: pathA.reduce((s, p) => s + p.y, 0) / pathA.length,
      avgYB: pathB.reduce((s, p) => s + p.y, 0) / pathB.length,
    };
  });
}

// ─── Build multi-round SMIL for one pokemon ───────────────────────────────────
// roundInfos: array of {path, eA, eB, role, delay, wDur, wt}, one per round
function buildMultiRoundPokemonSVG(pkIdx, roundInfos, spriteInfo) {
  if (!spriteInfo) return { defs: '', svg: '', avgY: 0 };

  const {
    walkUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
    strkUri, strkSheetW, strkSheetH, strkFrameW, strkFrameH, strkFrameCount, strkDurSec,
    hrtUri,  hrtSheetW,  hrtSheetH,  hrtFrameW,  hrtFrameH,  hrtFrameCount,  hrtDurSec,
    slpUri,  slpSheetW,  slpSheetH,  slpFrameW,  slpFrameH,  slpFrameCount,  slpDurSec,
  } = spriteInfo;

  const SS = SPRITE_SCALE;
  const dfw = frameW, dfh = frameH;
  const hw = dfw >> 1, hh = dfh >> 1;
  const pixPos = t => `${f1(t.x * TS + TS / 2)},${f1(t.y * TS + TS / 2)}`;
  const sprYForRow = row => -(hh + row * dfh) * SS;

  // Absolute-time event lists (t in seconds, v = string or number value)
  const posEvents  = [];
  const dirEvents  = [];
  const walkEvents = [];
  const slpEvents  = [];
  const strkEvents = [];
  const hrtEvents  = [];
  const flashEvents = [];

  let totalAvgY = 0;

  for (let ri = 0; ri < roundInfos.length; ri++) {
    const { path, eA, eB, role, delay, wDur, wt } = roundInfos[ri];
    const rOff = ri * ROUND_DUR;
    const pathRev = [...path].reverse();

    const walkStart  = rOff + delay;
    const battleStart = walkStart + wDur;
    const p0e = battleStart + PRE_DUR;
    const p1e = p0e + PHASES[0];
    const p2e = p1e + PHASES[1];
    const p3e = p2e + PHASES[2];
    const p4e = p3e + PHASES[3];
    const battleEnd  = battleStart + BATTLE_TOTAL;
    const returnEnd  = battleEnd + wDur;
    const roundEnd   = rOff + ROUND_DUR;

    totalAvgY += path.reduce((s, p) => s + p.y, 0) / path.length;

    // ── Position ────────────────────────────────────────────────────────────────
    posEvents.push({ t: rOff, v: pixPos(path[0]) });
    if (delay > 0) posEvents.push({ t: walkStart, v: pixPos(path[0]) });
    for (let i = 0; i <= wt; i++)
      posEvents.push({ t: walkStart + i * STEP_DUR, v: pixPos(path[i]) });
    posEvents.push({ t: battleEnd, v: pixPos(path[wt]) });
    for (let i = 1; i <= wt; i++)
      posEvents.push({ t: battleEnd + i * STEP_DUR, v: pixPos(pathRev[i]) });
    posEvents.push({ t: roundEnd, v: pixPos(path[0]) });

    // ── Direction (sprite Y row offset) ─────────────────────────────────────────
    const walkDir = (i) => {
      const from = path[i], to = path[Math.min(i + 1, wt)];
      return sprYForRow(dirRow(to.x - from.x, to.y - from.y));
    };
    if (delay > 0) dirEvents.push({ t: rOff, v: walkDir(0) });
    for (let i = 0; i <= wt; i++)
      dirEvents.push({ t: walkStart + i * STEP_DUR, v: walkDir(i) });
    const faceRow = role === 'A'
      ? dirRow(eB.x - eA.x, eB.y - eA.y)
      : dirRow(eA.x - eB.x, eA.y - eB.y);
    dirEvents.push({ t: battleStart, v: sprYForRow(faceRow) });
    dirEvents.push({ t: battleEnd,   v: sprYForRow(faceRow) });
    for (let i = 1; i <= wt; i++) {
      const from = pathRev[i - 1], to = pathRev[i];
      dirEvents.push({ t: battleEnd + (i - 1) * STEP_DUR, v: sprYForRow(dirRow(to.x - from.x, to.y - from.y)) });
    }
    dirEvents.push({ t: returnEnd, v: sprYForRow(0) }); // sleep faces south
    dirEvents.push({ t: roundEnd,  v: sprYForRow(0) });

    // ── Walk sprite display ──────────────────────────────────────────────────────
    walkEvents.push({ t: rOff,        v: 'inline' });
    walkEvents.push({ t: battleStart, v: 'none'   });
    walkEvents.push({ t: battleEnd,   v: 'inline' });
    walkEvents.push({ t: returnEnd,   v: 'none'   });
    walkEvents.push({ t: roundEnd,    v: 'none'   });

    // ── Sleep sprite display ─────────────────────────────────────────────────────
    slpEvents.push({ t: rOff,       v: 'none'   });
    slpEvents.push({ t: returnEnd,  v: 'inline' });
    slpEvents.push({ t: roundEnd,   v: 'none'   });

    // ── Strike / Hurt display ────────────────────────────────────────────────────
    strkEvents.push({ t: rOff, v: 'none' });
    hrtEvents.push(  { t: rOff, v: 'none' });
    if (role === 'A') {
      strkEvents.push({ t: p0e, v: 'inline' }); strkEvents.push({ t: p1e, v: 'none' });
      strkEvents.push({ t: p2e, v: 'inline' }); strkEvents.push({ t: p3e, v: 'none' });
      hrtEvents.push(  { t: p1e, v: 'inline' }); hrtEvents.push(  { t: p2e, v: 'none' });
      hrtEvents.push(  { t: p3e, v: 'inline' }); hrtEvents.push(  { t: p4e, v: 'none' });
    } else {
      strkEvents.push({ t: p1e, v: 'inline' }); strkEvents.push({ t: p2e, v: 'none' });
      strkEvents.push({ t: p3e, v: 'inline' }); strkEvents.push({ t: p4e, v: 'none' });
      hrtEvents.push(  { t: p0e, v: 'inline' }); hrtEvents.push(  { t: p1e, v: 'none' });
      hrtEvents.push(  { t: p2e, v: 'inline' }); hrtEvents.push(  { t: p3e, v: 'none' });
    }
    strkEvents.push({ t: roundEnd, v: 'none' });
    hrtEvents.push(  { t: roundEnd, v: 'none' });

    // ── Hit-flash ────────────────────────────────────────────────────────────────
    const FD = 0.3;
    flashEvents.push({ t: rOff, v: 0 });
    const hitTimes = role === 'A' ? [p1e, p3e] : [p0e, p2e];
    for (const ht of hitTimes) {
      flashEvents.push({ t: ht,      v: 0    });
      flashEvents.push({ t: ht + FD, v: 0.55 });
      flashEvents.push({ t: ht + FD * 2, v: 0 });
    }
    flashEvents.push({ t: roundEnd, v: 0 });
  }

  // ── Sort + deduplicate (same t → keep last) ────────────────────────────────
  function sortDedup(events) {
    events.sort((a, b) => a.t - b.t);
    const out = [];
    for (const e of events) {
      if (out.length && Math.abs(out[out.length - 1].t - e.t) < 1e-9)
        out[out.length - 1].v = e.v;
      else out.push({ ...e });
    }
    return out;
  }

  function toSMIL(events, defaultEnd) {
    const sd = sortDedup(events);
    if (!sd.length) return { kts: '0;1', vals: `${defaultEnd};${defaultEnd}` };
    if (sd[0].t > 1e-9) sd.unshift({ t: 0, v: sd[0].v });
    if (sd[sd.length - 1].t < TOTAL_DUR - 1e-9) sd.push({ t: TOTAL_DUR, v: sd[sd.length - 1].v });
    return {
      kts:  sd.map(e => f5(e.t / TOTAL_DUR)).join(';'),
      vals: sd.map(e => String(e.v)).join(';'),
    };
  }

  const posSMIL   = toSMIL(posEvents,   pixPos(roundInfos[0].path[0]));
  const dirSMIL   = toSMIL(dirEvents,   sprYForRow(0));
  const walkSMIL  = toSMIL(walkEvents,  'none');
  const slpSMIL   = toSMIL(slpEvents,   'none');
  const strkSMIL  = toSMIL(strkEvents,  'none');
  const hrtSMIL   = toSMIL(hrtEvents,   'none');
  const flashSMIL = toSMIL(flashEvents, 0);
  const avgY = totalAvgY / roundInfos.length;

  // ── SMIL elements ─────────────────────────────────────────────────────────────
  const clipId = `wc${pkIdx}`;
  let defsStr = `<clipPath id="${clipId}"><rect x="${-hw*SS}" y="${-hh*SS}" width="${dfw*SS}" height="${dfh*SS}"/></clipPath>`;

  const walkXVals = Array.from({ length: frameCount }, (_, f) => -(hw + f * dfw) * SS).join(';');
  const walkImg = `<image id="w${pkIdx}" href="${walkUri}"
      x="${-hw*SS}" y="${-hh*SS}" width="${sheetW*SS}" height="${sheetH*SS}" image-rendering="pixelated" clip-path="url(#${clipId})">
    <animate attributeName="x" values="${walkXVals}" dur="${durSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="y" values="${dirSMIL.vals}" keyTimes="${dirSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="${walkSMIL.vals}" keyTimes="${walkSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

  let strkImg = '', hrtImg = '', slpImg = '';

  if (strkUri && hrtUri) {
    const adfw = strkFrameW, adfh = strkFrameH;
    const ahw = adfw >> 1, ahh = adfh >> 1;
    const aClipId = `ac${pkIdx}`;
    defsStr += `\n  <clipPath id="${aClipId}"><rect x="${-ahw*SS}" y="${-ahh*SS}" width="${adfw*SS}" height="${adfh*SS}"/></clipPath>`;

    const info0 = roundInfos[0];
    const strkFaceRow = info0.role === 'A'
      ? dirRow(info0.eB.x - info0.eA.x, info0.eB.y - info0.eA.y)
      : dirRow(info0.eA.x - info0.eB.x, info0.eA.y - info0.eB.y);
    const strkY = -(ahh + strkFaceRow * adfh) * SS;
    const strkXVals = Array.from({ length: strkFrameCount }, (_, f) => -(ahw + f * adfw) * SS).join(';');

    strkImg = `<image id="a${pkIdx}" href="${strkUri}"
      x="${-ahw*SS}" y="${strkY}" width="${strkSheetW*SS}" height="${strkSheetH*SS}" image-rendering="pixelated" clip-path="url(#${aClipId})">
    <animate attributeName="x" values="${strkXVals}" dur="${strkDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="${strkSMIL.vals}" keyTimes="${strkSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

    const hdfw = hrtFrameW, hdfh = hrtFrameH;
    const hhw = hdfw >> 1, hhh = hdfh >> 1;
    const hClipId = `hc${pkIdx}`;
    defsStr += `\n  <clipPath id="${hClipId}"><rect x="${-hhw*SS}" y="${-hhh*SS}" width="${hdfw*SS}" height="${hdfh*SS}"/></clipPath>`;

    const hrtFaceRow = info0.role === 'A'
      ? dirRow(info0.eB.x - info0.eA.x, info0.eB.y - info0.eA.y)
      : dirRow(info0.eA.x - info0.eB.x, info0.eA.y - info0.eB.y);
    const hrtY = -(hhh + hrtFaceRow * hdfh) * SS;
    const hrtXVals = Array.from({ length: hrtFrameCount }, (_, f) => -(hhw + f * hdfw) * SS).join(';');

    hrtImg = `<image id="h${pkIdx}" href="${hrtUri}"
      x="${-hhw*SS}" y="${hrtY}" width="${hrtSheetW*SS}" height="${hrtSheetH*SS}" image-rendering="pixelated" clip-path="url(#${hClipId})">
    <animate attributeName="x" values="${hrtXVals}" dur="${hrtDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="${hrtSMIL.vals}" keyTimes="${hrtSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  if (slpUri) {
    const sfW = slpFrameW, sfH = slpFrameH;
    const shw = sfW >> 1, shh = sfH >> 1;
    const slpClipId = `sc${pkIdx}`;
    defsStr += `\n  <clipPath id="${slpClipId}"><rect x="${-shw*SS}" y="${-shh*SS}" width="${sfW*SS}" height="${sfH*SS}"/></clipPath>`;
    const slpXVals = Array.from({ length: slpFrameCount }, (_, f) => -(shw + f * sfW) * SS).join(';');

    slpImg = `<image id="s${pkIdx}" href="${slpUri}"
      x="${-shw*SS}" y="${-shh*SS}" width="${slpSheetW*SS}" height="${slpSheetH*SS}" image-rendering="pixelated" clip-path="url(#${slpClipId})">
    <animate attributeName="x" values="${slpXVals}" dur="${slpDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="${slpSMIL.vals}" keyTimes="${slpSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  const flashImg = `<circle cx="0" cy="0" r="${TS * 0.7}" fill="white" opacity="0">
    <animate attributeName="opacity" values="${flashSMIL.vals}" keyTimes="${flashSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="linear" repeatCount="indefinite"/>
  </circle>`;

  const shadowY       = f1(hh * SS * 0.42);
  const shadowRx      = f1(dfw * SS * 0.36);
  const shadowRy      = f1(TS * 0.12);
  const shadowYSleep  = f1(hh * SS * 0.88);
  const shadowRySleep = f1(TS * 0.07);
  const shadowCyVals  = slpSMIL.vals.replace(/inline/g, shadowYSleep).replace(/none/g, shadowY);
  const shadowRyVals  = slpSMIL.vals.replace(/inline/g, shadowRySleep).replace(/none/g, shadowRy);

  const shadowEll = `<ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.55)">
    <animate attributeName="cy" values="${shadowCyVals}" keyTimes="${slpSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="ry" values="${shadowRyVals}" keyTimes="${slpSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
  </ellipse>`;

  const zx1 = f1(dfw * SS * 0.25), zx2 = f1(dfw * SS * 0.40), zx3 = f1(dfw * SS * 0.55);
  const zy0 = f1(-hh * SS * 0.9);
  const zzzImg = `<g>
    <animate attributeName="display" values="${slpSMIL.vals}" keyTimes="${slpSMIL.kts}" dur="${TOTAL_DUR.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    <text x="${zx1}" font-size="11" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.55)}" dur="1.8s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.9;0" dur="1.8s" calcMode="linear" repeatCount="indefinite"/>z</text>
    <text x="${zx2}" font-size="9" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.7)}" dur="1.8s" begin="0.6s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.75;0" dur="1.8s" begin="0.6s" calcMode="linear" repeatCount="indefinite"/>z</text>
    <text x="${zx3}" font-size="7" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.9)}" dur="1.8s" begin="1.2s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.55;0" dur="1.8s" begin="1.2s" calcMode="linear" repeatCount="indefinite"/>z</text>
  </g>`;

  const svg = `
  <g id="pk${pkIdx}">
    <animateTransform attributeName="transform" type="translate"
      values="${posSMIL.vals}" keyTimes="${posSMIL.kts}"
      dur="${TOTAL_DUR.toFixed(3)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    ${shadowEll}
    ${walkImg}
    ${strkImg}
    ${hrtImg}
    ${slpImg}
    ${zzzImg}
    ${flashImg}
  </g>`;

  return { defs: defsStr, svg, avgY };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG (multi-round) ...');
  console.log(`  Map: ${MAP_W}x${MAP_H} tiles at ${TS}px`);
  console.log(`  Cycle: ${TOTAL_DUR}s total (${ROUND_DUR}s×${ROUNDS.length} rounds)`);

  // Load sprites: walk + strike + hurt + sleep
  const spriteInfos = POKEMON.map(def => {
    const wp = (def.animations.walk ?? '').replace(/^\.\//, '');
    if (!wp || !existsSync(wp)) { console.warn(`  ! Walk missing: ${def.name}`); return null; }
    const wa = parseAnim(wp, 'Walk');
    if (!wa) { console.warn(`  ! No Walk AnimData: ${def.name}`); return null; }
    const { w: sW, h: sH } = pngSize(wp);
    const walkUri = `data:image/png;base64,${readFileSync(wp).toString('base64')}`;
    console.log(`  ok ${def.name}  Walk ${wa.frameW}x${wa.frameH}  ${wa.frameCount}f`);

    function loadAnim(animKey) {
      const p = (def.animations[animKey] ?? '').replace(/^\.\//, '');
      if (!p || !existsSync(p)) { console.warn(`    ! ${animKey} missing for ${def.name}`); return null; }
      const xmlName = animNameFromFile(p);
      const a = parseAnim(p, xmlName);
      if (!a) { console.warn(`    ! No ${xmlName} AnimData for ${def.name}`); return null; }
      const { w, h } = pngSize(p);
      const uri = `data:image/png;base64,${readFileSync(p).toString('base64')}`;
      console.log(`    ${xmlName}: ${a.frameW}x${a.frameH}  ${a.frameCount}f`);
      return { uri, sheetW: w, sheetH: h, ...a };
    }

    const st = loadAnim('strike');
    const hr = loadAnim('hurt');
    const sl = loadAnim('sleep');

    return {
      walkUri, sheetW: sW, sheetH: sH, ...wa,
      strkUri:       st?.uri,    strkSheetW: st?.sheetW, strkSheetH: st?.sheetH,
      strkFrameW:    st?.frameW, strkFrameH: st?.frameH, strkFrameCount: st?.frameCount, strkDurSec: st?.durSec,
      hrtUri:        hr?.uri,    hrtSheetW:  hr?.sheetW, hrtSheetH:  hr?.sheetH,
      hrtFrameW:     hr?.frameW, hrtFrameH:  hr?.frameH, hrtFrameCount:  hr?.frameCount, hrtDurSec:  hr?.durSec,
      slpUri:        sl?.uri,    slpSheetW:  sl?.sheetW, slpSheetH:  sl?.sheetH,
      slpFrameW:     sl?.frameW, slpFrameH:  sl?.frameH, slpFrameCount:  sl?.frameCount, slpDurSec:  sl?.durSec,
    };
  });

  // ── Download dungeon tileset from PMDCollab/RawAsset ─────────────────────────
  const DUNGEON_NAME = 'CrystalCave1';
  const TILESET_URL  = `https://raw.githubusercontent.com/PMDCollab/RawAsset/master/TileDtef/${DUNGEON_NAME}/tileset_0.png`;
  let tilesetUri = null;
  try {
    const buf = await fetchBuffer(TILESET_URL);
    tilesetUri = `data:image/png;base64,${buf.toString('base64')}`;
    console.log(`  Tileset loaded: ${DUNGEON_NAME} (${(buf.length/1024).toFixed(0)} KB)`);
  } catch (e) {
    console.warn(`  ! Tileset download failed (${e.message}), using solid colours`);
  }

  const patternDefs = tilesetUri ? [
    tilePattern('patWall0',     tilesetUri,  48, 144),
    tilePattern('patWall1',     tilesetUri,  72, 144),
    tilePattern('patWall2',     tilesetUri,  96, 144),
    tilePattern('patWall3',     tilesetUri, 120, 144),
    tilePattern('patWallEdge0', tilesetUri,  48,  24),
    tilePattern('patWallEdge1', tilesetUri,  72,  24),
    tilePattern('patFloor0',    tilesetUri, 360, 144),
    tilePattern('patFloor1',    tilesetUri, 384, 144),
    tilePattern('patFloor2',    tilesetUri, 408, 144),
    tilePattern('patCorr0',     tilesetUri, 312, 120),
    tilePattern('patCorr1',     tilesetUri, 336, 120),
    tilePattern('patWater',     tilesetUri, 240, 144),
  ].join('\n  ') : '';

  // Generate dungeon
  const { grid, rooms, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms (${W}x${H} tiles)`);

  // ── Build paths for each round (independent collision avoidance per round) ────
  const allRoundPaths = ROUNDS.map((roundDef, ri) => {
    const pkNames = roundDef.pairs.map(([a, b]) => `${POKEMON[a].name}↔${POKEMON[b].name}`).join(', ');
    console.log(`  Round ${ri + 1}: ${pkNames}  delays=${roundDef.delays}`);
    return buildRoundPaths(roundDef, rooms, grid, W, H);
  });

  // ── Collect per-pokemon info across rounds ─────────────────────────────────
  const pkRoundInfos = {};  // pkIdx → [{path,eA,eB,role,delay,wDur,wt}, ...]
  for (let roundIdx = 0; roundIdx < ROUNDS.length; roundIdx++) {
    for (const pair of allRoundPaths[roundIdx]) {
      if (!pkRoundInfos[pair.pkA]) pkRoundInfos[pair.pkA] = [];
      if (!pkRoundInfos[pair.pkB]) pkRoundInfos[pair.pkB] = [];
      pkRoundInfos[pair.pkA].push({ path: pair.pathA, eA: pair.eA, eB: pair.eB, role: 'A', delay: pair.delay, wDur: pair.wDur, wt: pair.wt });
      pkRoundInfos[pair.pkB].push({ path: pair.pathB, eA: pair.eA, eB: pair.eB, role: 'B', delay: pair.delay, wDur: pair.wDur, wt: pair.wt });
    }
  }

  // ── Build per-pokemon SVG ──────────────────────────────────────────────────
  const pkParts = [];
  for (const pkIdx of Object.keys(pkRoundInfos).map(Number).sort()) {
    const infos = pkRoundInfos[pkIdx];
    if (!spriteInfos[pkIdx]) { console.warn(`  ! No sprite for ${POKEMON[pkIdx].name}`); continue; }
    console.log(`  ${POKEMON[pkIdx].name}: ${infos.length} rounds`);
    pkParts.push(buildMultiRoundPokemonSVG(pkIdx, infos, spriteInfos[pkIdx]));
  }

  // ── Y-sort: lower avgY renders first (behind) ──────────────────────────────
  pkParts.sort((a, b) => a.avgY - b.avgY);

  const pkDefs = pkParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pkSVGs = pkParts.map(p => p.svg).join('\n');
  const dungeonSVG = dungeonToSVG(grid, W, H, !!tilesetUri);
  const crystalFX  = tilesetUri ? crystalDecorations(grid, W, H) : '';
  const waterFX    = waterAnimSVG(grid, W, H);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
<style>
@keyframes wsh{0%,100%{opacity:0.06}50%{opacity:0.35}}
.wsh{animation:wsh 2.1s ease-in-out infinite}
</style>
<defs>
  <radialGradient id="vignette" cx="50%" cy="50%" r="68%">
    <stop offset="0%"   stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(0,0,14,0.62)"/>
  </radialGradient>
  ${patternDefs}
  ${pkDefs}
</defs>

<rect width="${SVG_W}" height="${SVG_H}" fill="${C.bgDark}"/>
<g id="dungeon">${dungeonSVG}</g>
<g id="crystals" opacity="0.9">${crystalFX}</g>
<g id="wfx" opacity="0.75">${waterFX}</g>
<g id="npcs">${pkSVGs}</g>
<rect width="${SVG_W}" height="${SVG_H}" fill="url(#vignette)" pointer-events="none"/>
</svg>
`;

  mkdirSync('assets', { recursive: true });
  writeFileSync('assets/pokemon-world.svg', svg, 'utf8');
  console.log(`Written assets/pokemon-world.svg  (${(svg.length/1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
