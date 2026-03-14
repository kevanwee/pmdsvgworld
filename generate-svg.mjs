import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, basename } from 'path';
import { get } from 'https';
import { POKEMON_DEFS } from './src/config.js';

// ─── Sprite scale (applied to all sprite images, not tile size) ───────────────
const SPRITE_SCALE = 2;

// ─── Layout constants ─────────────────────────────────────────────────────────
const SVG_W   = 960;
const SVG_H   = 720;
const TS      = 48;          // tile px
const MAP_W   = Math.floor(SVG_W / TS);   // 20
const MAP_H   = Math.floor(SVG_H / TS);   // 15
const ROW_MIN = 0;
const ROW_MAX = MAP_H - 1;

// ─── Battle / movement timing ─────────────────────────────────────────────────
const STEP_DUR     = 0.20;    // seconds per tile (constant for ALL pokemon)
const WALK_TILES   = 20;      // one-way walk steps before encounter
// 4 exchange phases — varying durations for back-and-forth feel
const PHASES       = [0.40, 0.60, 0.45, 0.55];
const PRE_DUR      = 0.20;    // face-off pause before first strike
const POST_DUR     = 0.25;    // disengage pause after last strike
const BATTLE_TOTAL = PRE_DUR + PHASES.reduce((a, b) => a + b, 0) + POST_DUR; // 2.45 s
const SLEEP_DUR    = 2.5;     // sleep at home tile before next cycle
const PAIR_DUR     = 2 * WALK_TILES * STEP_DUR + BATTLE_TOTAL + SLEEP_DUR;   // 12.95 s

// ─── Fractional phase boundaries (0-1 within PAIR_DUR) ───────────────────────
const W_DUR  = WALK_TILES * STEP_DUR;   // 4.0 s
const bs     = W_DUR / PAIR_DUR;                          // battle start
const p0e    = bs   + PRE_DUR   / PAIR_DUR;               // pre-battle ends
const p1e    = p0e  + PHASES[0] / PAIR_DUR;               // phase 0 ends (A attacked B)
const p2e    = p1e  + PHASES[1] / PAIR_DUR;               // phase 1 ends (B attacked A)
const p3e    = p2e  + PHASES[2] / PAIR_DUR;               // phase 2 ends (A attacked B)
const p4e    = p3e  + PHASES[3] / PAIR_DUR;               // phase 3 ends (B attacked A)
const be     = p4e  + POST_DUR  / PAIR_DUR;               // battle end, resume walk
const bkend  = be   + W_DUR     / PAIR_DUR;               // backward walk done -> sleep

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

  const COLS = 4, ROWS = 3;
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

  // Stair + scatter items/traps
  const lr = rooms[rooms.length - 1];
  grid[lr.cy][lr.cx] = T.STAIR;
  let placed = 0;
  for (let a = 0; a < 500 && placed < 6; a++) {
    const tx = ri(1, W - 1), ty = ri(ROW_MIN, ROW_MAX + 1);
    if (grid[ty][tx] === T.FLOOR) { grid[ty][tx] = placed++ < 3 ? T.ITEM : T.TRAP; }
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
function renderTile(tx, ty, type, ts = false) {
  const r = (x, y, w, h, c, extra = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`;
  switch (type) {
    case T.WALL:
      return r(tx, ty, TS, TS, C.bgDark) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, ts ? 'url(#patWall)' : C.wallInner);

    case T.FLOOR:
      return r(tx, ty, TS, TS, ts ? 'url(#patFloor)' : C.floorGrout) +
             (ts ? '' : r(tx + 1, ty + 1, TS - 2, TS - 2, C.floorFill)) +
             r(tx + 1,   ty + 1,   TS - 2, 1,      C.floorHi)    +
             r(tx + 1,   ty + 1,   1,      TS - 3, C.floorHi)    +
             r(tx + 1,   ty+TS-2,  TS - 2, 1,      C.floorSh)    +
             r(tx+TS-2,  ty + 2,   1,      TS - 3, C.floorSh);

    case T.CORR:
      return r(tx, ty, TS, TS, ts ? 'url(#patCorr)' : C.corrGrout) +
             (ts ? '' : r(tx + 1, ty + 1, TS - 2, TS - 2, C.corrFill)) +
             r(tx + 1, ty + 1, TS - 2, 1, C.corrHi) +
             r(tx + 1, ty + 1, 1,      TS - 3, C.corrHi);

    case T.WATER:
      return r(tx, ty, TS, TS, ts ? 'url(#patWater)' : C.waterFill) +
             r(tx, ty + Math.round(TS * 0.28), TS, 2, C.waterShine, ' opacity="0.6"') +
             r(tx, ty + Math.round(TS * 0.64), TS, 2, C.waterShine, ' opacity="0.6"');

    case T.STAIR:
      return r(tx, ty, TS, TS, C.floorGrout) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.stairFill) +
             r(tx + 1, ty + 1, TS - 2, 1, C.stairHi) +
             `<rect x="${tx + Math.round(TS * 0.43)}" y="${ty + Math.round(TS * 0.2)}" width="${Math.round(TS * 0.14)}" height="${Math.round(TS * 0.36)}" fill="#2A1A06"/>` +
             `<polygon points="${f1(tx+TS*0.5)},${f1(ty+TS*0.82)} ${f1(tx+TS*0.27)},${f1(ty+TS*0.52)} ${f1(tx+TS*0.73)},${f1(ty+TS*0.52)}" fill="#2A1A06"/>`;

    case T.ITEM:
      return r(tx, ty, TS, TS, C.floorGrout) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.floorFill) +
             `<circle cx="${f1(tx+TS*0.5)}" cy="${f1(ty+TS*0.5)}" r="${f1(TS*0.25)}" fill="${C.itemOrb}" stroke="${C.itemStroke}" stroke-width="0.8"/>` +
             `<circle cx="${f1(tx+TS*0.41)}" cy="${f1(ty+TS*0.41)}" r="${f1(TS*0.08)}" fill="white" opacity="0.55"/>`;

    case T.TRAP:
      return r(tx, ty, TS, TS, C.floorGrout) +
             r(tx + 1, ty + 1, TS - 2, TS - 2, C.floorFill) +
             `<polygon points="${f1(tx+TS*0.5)},${f1(ty+TS*0.19)} ${f1(tx+TS*0.81)},${f1(ty+TS*0.77)} ${f1(tx+TS*0.19)},${f1(ty+TS*0.77)}" fill="${C.trapFill}" stroke="#600" stroke-width="0.5"/>` +
             `<text x="${f1(tx+TS*0.5)}" y="${f1(ty+TS*0.65)}" text-anchor="middle" font-size="${Math.round(TS*0.30)}" fill="white" font-weight="bold">!</text>`;

    default: return '';
  }
}

function dungeonToSVG(grid, W, H, ts = false) {
  const tiles = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      tiles.push(renderTile(x * TS, y * TS, grid[y][x], ts));

  const depth = [];
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] === T.WALL && grid[y - 1][x] !== T.WALL)
      depth.push(`<rect x="${x*TS}" y="${y*TS}" width="${TS}" height="4" fill="${C.wallFace}"/>`);
    if (grid[y][x] !== T.WALL && grid[y + 1]?.[x] === T.WALL)
      depth.push(`<rect x="${x*TS}" y="${(y+1)*TS}" width="${TS}" height="3" fill="rgba(0,0,0,0.45)"/>`);
  }
  return tiles.join('') + depth.join('');
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

// ─── Build pair paths with collision avoidance ────────────────────────────────
function buildPairPaths(rooms, grid, W, H, ridxA, ridxB, avoidTiles, hardBlocks) {
  const rA = rooms[ridxA], rB = rooms[ridxB];
  const full = dijkstraPath(grid, W, H, rA.cx, rA.cy, rB.cx, rB.cy, avoidTiles, hardBlocks);
  const K = full.length - 1;
  const m = Math.max(1, K >> 1);

  let pathA = full.slice(0, m + 1);
  let pathB = full.slice(m + 1).reverse();
  if (pathB.length < 2) pathB = [{ ...full[K] }, { ...full[K] }];

  function normalisePath(path) {
    while (path.length < WALK_TILES + 1) path.unshift({ ...path[0] });
    if (path.length > WALK_TILES + 1) path = path.slice(path.length - (WALK_TILES + 1));
    return path;
  }
  pathA = normalisePath(pathA);
  pathB = normalisePath(pathB);

  // Register tiles so later pairs route around them (soft avoid)
  pathA.forEach(p => avoidTiles.add(`${p.x},${p.y}`));
  pathB.forEach(p => avoidTiles.add(`${p.x},${p.y}`));
  // Hard-block home (sleep) tiles so later pairs never walk through them
  hardBlocks.add(`${pathA[0].x},${pathA[0].y}`);
  hardBlocks.add(`${pathB[0].x},${pathB[0].y}`);

  return { pathA, pathB, eA: pathA[WALK_TILES], eB: pathB[WALK_TILES] };
}

// ─── Build a single pokemon's full SMIL animation ────────────────────────────
// role 'A' attacks in phases 0 & 2, role 'B' attacks in phases 1 & 3
function buildPokemonSVG(pkIdx, _def, path, eA, eB, role, delaySec, spriteInfo) {
  if (!spriteInfo) return { defs: '', svg: '' };

  const {
    walkUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
    strkUri, strkSheetW, strkSheetH, strkFrameW, strkFrameH, strkFrameCount, strkDurSec,
    hrtUri,  hrtSheetW,  hrtSheetH,  hrtFrameW,  hrtFrameH,  hrtFrameCount,  hrtDurSec,
    slpUri,  slpSheetW,  slpSheetH,  slpFrameW,  slpFrameH,  slpFrameCount,  slpDurSec,
  } = spriteInfo;

  const SS  = SPRITE_SCALE;
  const dfw = frameW, dfh = frameH;
  const hw  = dfw >> 1, hh = dfh >> 1;

  // ── Position keyTimes and values ─────────────────────────────────────────────
  const pathRev = [...path].reverse();

  const allKts = [
    ...Array.from({ length: WALK_TILES + 1 }, (_, i) => i * STEP_DUR / PAIR_DUR),
    be,
    ...Array.from({ length: WALK_TILES }, (_, i) => be + (i + 1) * STEP_DUR / PAIR_DUR),
    1.0,
  ];

  const pixPos = t => `${f1(t.x * TS + TS / 2)},${f1(t.y * TS + TS / 2)}`;
  const allPos = [
    ...path.map(pixPos),
    pixPos(path[WALK_TILES]),
    ...pathRev.slice(1).map(pixPos),
    pixPos(path[0]),
  ];

  const ktStr  = allKts.map(f5).join(';');
  const posStr = allPos.join(';');

  // Walk direction Y-offset per keyframe (scaled)
  const opponent = role === 'A' ? eB : eA;
  const dirY = (from, to) => -(hh + dirRow(to.x - from.x, to.y - from.y) * dfh) * SS;
  const allDirY = [
    ...Array.from({ length: WALK_TILES + 1 }, (_, i) => {
      const from = path[i], to = path[Math.min(i + 1, WALK_TILES)];
      return dirY(from, to);
    }),
    dirY(path[WALK_TILES], opponent),
    ...Array.from({ length: WALK_TILES }, (_, i) => {
      const from = pathRev[i + 1], to = pathRev[Math.min(i + 2, WALK_TILES)];
      return dirY(from, to);
    }),
    -hh * SS,  // sleep: row 0
  ];

  const clipId = `wc${pkIdx}`;
  let defsStr = `<clipPath id="${clipId}"><rect x="${-hw*SS}" y="${-hh*SS}" width="${dfw*SS}" height="${dfh*SS}"/></clipPath>`;

  // ── Walk sprite ───────────────────────────────────────────────────────────────
  const walkXVals = Array.from({ length: frameCount }, (_, f) => -(hw + f * dfw) * SS).join(';');
  const walkImg = `<image id="w${pkIdx}" href="${walkUri}"
      x="${-hw*SS}" y="${-hh*SS}" width="${sheetW*SS}" height="${sheetH*SS}" image-rendering="pixelated" clip-path="url(#${clipId})">
    <animate attributeName="x" values="${walkXVals}" dur="${durSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="y" values="${allDirY.join(';')}" keyTimes="${ktStr}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="inline;none;inline;none" keyTimes="0;${f5(bs)};${f5(be)};${f5(bkend)}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

  // ── Strike / Hurt sprites ─────────────────────────────────────────────────────
  let strkImg = '', hrtImg = '', slpImg = '';
  if (strkUri && hrtUri) {
    const adfw = strkFrameW, adfh = strkFrameH;
    const ahw = adfw >> 1, ahh = adfh >> 1;
    const aClipId = `ac${pkIdx}`;
    defsStr += `\n  <clipPath id="${aClipId}"><rect x="${-ahw*SS}" y="${-ahh*SS}" width="${adfw*SS}" height="${adfh*SS}"/></clipPath>`;

    const strkFaceDir = role === 'A'
      ? dirRow(eB.x - eA.x, eB.y - eA.y)
      : dirRow(eA.x - eB.x, eA.y - eB.y);
    const strkY = -(ahh + strkFaceDir * adfh) * SS;
    const strkXVals = Array.from({ length: strkFrameCount }, (_, f) => -(ahw + f * adfw) * SS).join(';');
    const strkKt = role === 'A'
      ? `0;${f5(p0e)};${f5(p1e)};${f5(p2e)};${f5(p3e)}`
      : `0;${f5(p1e)};${f5(p2e)};${f5(p3e)};${f5(p4e)}`;

    strkImg = `<image id="a${pkIdx}" href="${strkUri}"
      x="${-ahw*SS}" y="${strkY}" width="${strkSheetW*SS}" height="${strkSheetH*SS}" image-rendering="pixelated" clip-path="url(#${aClipId})">
    <animate attributeName="x" values="${strkXVals}" dur="${strkDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none;inline;none" keyTimes="${strkKt}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

    const hdfw = hrtFrameW, hdfh = hrtFrameH;
    const hhw = hdfw >> 1, hhh = hdfh >> 1;
    const hClipId = `hc${pkIdx}`;
    defsStr += `\n  <clipPath id="${hClipId}"><rect x="${-hhw*SS}" y="${-hhh*SS}" width="${hdfw*SS}" height="${hdfh*SS}"/></clipPath>`;

    const hrtFaceDir = role === 'A'
      ? dirRow(eB.x - eA.x, eB.y - eA.y)
      : dirRow(eA.x - eB.x, eA.y - eB.y);
    const hrtY = -(hhh + hrtFaceDir * hdfh) * SS;
    const hrtXVals = Array.from({ length: hrtFrameCount }, (_, f) => -(hhw + f * hdfw) * SS).join(';');
    const hrtKt = role === 'A'
      ? `0;${f5(p1e)};${f5(p2e)};${f5(p3e)};${f5(p4e)}`
      : `0;${f5(p0e)};${f5(p1e)};${f5(p2e)};${f5(p3e)}`;

    hrtImg = `<image id="h${pkIdx}" href="${hrtUri}"
      x="${-hhw*SS}" y="${hrtY}" width="${hrtSheetW*SS}" height="${hrtSheetH*SS}" image-rendering="pixelated" clip-path="url(#${hClipId})">
    <animate attributeName="x" values="${hrtXVals}" dur="${hrtDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none;inline;none" keyTimes="${hrtKt}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  // ── Sleep sprite ──────────────────────────────────────────────────────────────
  if (slpUri) {
    const sfW = slpFrameW, sfH = slpFrameH;
    const shw = sfW >> 1, shh = sfH >> 1;
    const slpClipId = `sc${pkIdx}`;
    defsStr += `\n  <clipPath id="${slpClipId}"><rect x="${-shw*SS}" y="${-shh*SS}" width="${sfW*SS}" height="${sfH*SS}"/></clipPath>`;
    const slpXVals = Array.from({ length: slpFrameCount }, (_, f) => -(shw + f * sfW) * SS).join(';');
    slpImg = `<image id="s${pkIdx}" href="${slpUri}"
      x="${-shw*SS}" y="${-shh*SS}" width="${slpSheetW*SS}" height="${slpSheetH*SS}" image-rendering="pixelated" clip-path="url(#${slpClipId})">
    <animate attributeName="x" values="${slpXVals}" dur="${slpDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline" keyTimes="0;${f5(bkend)}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  // ── Hit-flash ─────────────────────────────────────────────────────────────────
  const fd = 0.3 / PAIR_DUR;
  const flashKt = role === 'A'
    ? `0;${f5(p1e)};${f5(p1e+fd)};${f5(p2e)};${f5(p3e)};${f5(p3e+fd)};${f5(p4e)}`
    : `0;${f5(p0e)};${f5(p0e+fd)};${f5(p1e)};${f5(p2e)};${f5(p2e+fd)};${f5(p3e)}`;
  const flashImg = `<circle cx="0" cy="0" r="${TS * 0.7}" fill="white" opacity="0">
    <animate attributeName="opacity" values="0;0;0.55;0;0;0.55;0" keyTimes="${flashKt}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
  </circle>`;

  const shadowY  = f1(hh * SS * 0.42);
  const shadowRx = f1(dfw * SS * 0.36);
  const shadowRy = f1(TS * 0.12);

  const svg = `
  <g id="pk${pkIdx}">
    <animateTransform attributeName="transform" type="translate"
      values="${posStr}" keyTimes="${ktStr}"
      dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.55)"/>
    ${walkImg}
    ${strkImg}
    ${hrtImg}
    ${slpImg}
    ${flashImg}
  </g>`;

  return { defs: defsStr, svg };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG ...');
  console.log(`  Map: ${MAP_W}x${MAP_H} tiles at ${TS}px`);
  console.log(`  PAIR_DUR=${PAIR_DUR.toFixed(2)}s  (walk=${W_DUR}s x2, battle=${BATTLE_TOTAL.toFixed(2)}s, sleep=${SLEEP_DUR}s)`);

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
  // SealedRuin tileset: 432×192 (18×8 tiles), 3 sections of 6×8
  // Section 0 (wall): x 0–143  | Section 1 (water): x 144–287 | Section 2 (floor): x 288–431
  // Row 6 (y=144) = interior surrounded tiles — good default for inner floor/wall
  const DUNGEON_NAME = 'SealedRuin';
  const TILESET_URL  = `https://raw.githubusercontent.com/PMDCollab/RawAsset/master/TileDtef/${DUNGEON_NAME}/tileset_0.png`;
  let tilesetUri = null;
  try {
    const buf = await fetchBuffer(TILESET_URL);
    tilesetUri = `data:image/png;base64,${buf.toString('base64')}`;
    console.log(`  Tileset loaded: ${DUNGEON_NAME} (${(buf.length/1024).toFixed(0)} KB)`);
  } catch (e) {
    console.warn(`  ! Tileset download failed (${e.message}), using solid colours`);
  }

  // Build pattern defs (one 24×24 crop per tile type, scaled to TS×TS)
  const patternDefs = tilesetUri ? [
    tilePattern('patFloor', tilesetUri, 384, 144),   // section 2, row 6, col 4 — inner floor
    tilePattern('patWall',  tilesetUri,  96, 144),   // section 0, row 6, col 4 — inner wall
    tilePattern('patCorr',  tilesetUri, 312, 120),   // section 2, row 5, col 1 — corridor
    tilePattern('patWater', tilesetUri, 240, 144),   // section 1, row 6, col 4 — water
  ].join('\n  ') : '';

  // Generate dungeon
  const { grid, rooms, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms (${W}x${H} tiles)`);

  // Build paths with spatial collision avoidance (each pair prefers unused tiles)
  const avoidTiles = new Set();
  const hardBlocks = new Set();
  const pairRoomIdxs = [
    [0, rooms.length - 1],
    [2, rooms.length - 3],
    [1, rooms.length - 2],
  ];
  const pairDelays = [0.5, PAIR_DUR * 0.38, PAIR_DUR * 0.72];

  const pkParts = [];
  for (let pairIdx = 0; pairIdx < 3; pairIdx++) {
    const [ridxA, ridxB] = pairRoomIdxs[pairIdx];
    const { pathA, pathB, eA, eB } = buildPairPaths(rooms, grid, W, H, ridxA, ridxB, avoidTiles, hardBlocks);
    const delay = pairDelays[pairIdx];
    const idxA = pairIdx * 2, idxB = pairIdx * 2 + 1;
    console.log(`  Pair ${pairIdx}: ${POKEMON[idxA].name} (room ${ridxA}) <-> ${POKEMON[idxB].name} (room ${ridxB})`);
    pkParts.push({ ...buildPokemonSVG(idxA, POKEMON[idxA], pathA, eA, eB, 'A', delay, spriteInfos[idxA]), homeY: pathA[0].y });
    pkParts.push({ ...buildPokemonSVG(idxB, POKEMON[idxB], pathB, eA, eB, 'B', delay, spriteInfos[idxB]), homeY: pathB[0].y });
  }

  // ── Y-sort: lower homeY (higher on screen) renders first → behind ─────────────
  pkParts.sort((a, b) => a.homeY - b.homeY);

  const pkDefs = pkParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pkSVGs = pkParts.map(p => p.svg).join('\n');
  const dungeonSVG = dungeonToSVG(grid, W, H, !!tilesetUri);
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

