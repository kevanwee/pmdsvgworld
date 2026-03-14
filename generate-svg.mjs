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
// 4-phase battle exchange durations
const PHASES       = [0.40, 0.60, 0.45, 0.55];
const PRE_DUR      = 0.20;    // face-off pause before first strike
const POST_DUR     = 0.25;    // disengage pause after last strike
const BATTLE_TOTAL = PRE_DUR + PHASES.reduce((a, b) => a + b, 0) + POST_DUR; // 2.45 s

// ─── Per-pokemon independent cycle timing ─────────────────────────────────────
// Each pokemon walks a multi-stop circuit; cycle = sum(leg tiles)*STEP_DUR + battle + brief rest.
// Using prime-ish leg counts per pokemon so cycles never synchronise → near-infinite variation.
// Layout of one cycle:
//   leg0 walk (home→encounter1) | battle1 | leg1 walk (enc1→enc2) | battle2 | leg2 walk back | rest
// rest is short (~15-18% of cycle) so pokemon spend most time moving.
const REST_DUR = 3.5;   // brief rest at home between circuits
//
// makeCycleTiming(legs) where legs=[l0, l1, l2] tile counts
function makeCycleTiming(legs) {
  const walkTotal = legs.reduce((s, l) => s + l, 0);
  const cycleDur  = walkTotal * STEP_DUR + 2 * BATTLE_TOTAL + REST_DUR;
  // cumulative time fractions
  const t = (s) => s / cycleDur;
  let acc = 0;
  const legEnds = legs.map(l => { acc += l * STEP_DUR; return t(acc); });
  // battle 1 after leg 0
  const b1s   = legEnds[0];
  const b1p0e = b1s + t(PRE_DUR);
  const b1p1e = b1p0e + t(PHASES[0]);
  const b1p2e = b1p1e + t(PHASES[1]);
  const b1p3e = b1p2e + t(PHASES[2]);
  const b1p4e = b1p3e + t(PHASES[3]);
  const b1e   = b1p4e + t(POST_DUR);
  // leg 1
  acc = b1e * cycleDur + legs[1] * STEP_DUR;
  const b2s   = t(acc);
  const b2p0e = b2s + t(PRE_DUR);
  const b2p1e = b2p0e + t(PHASES[0]);
  const b2p2e = b2p1e + t(PHASES[1]);
  const b2p3e = b2p2e + t(PHASES[2]);
  const b2p4e = b2p3e + t(PHASES[3]);
  const b2e   = b2p4e + t(POST_DUR);
  // leg 2 then rest
  const restStart = Math.min(b2e + t(legs[2] * STEP_DUR), 0.9999);
  return {
    cycleDur, legs,
    legEnds,
    b1s, b1p0e, b1p1e, b1p2e, b1p3e, b1p4e, b1e,
    b2s, b2p0e, b2p1e, b2p2e, b2p3e, b2p4e, b2e,
    restStart,
  };
}
// Each pokemon has unique prime-ish legs → cycles never align → ~hours of unique variation
// 6 pokemon, 6 distinct cycle lengths
const POKEMON_CYCLES = [
  makeCycleTiming([14, 11, 17]),  // ≈10.5s cycle
  makeCycleTiming([19, 13, 16]),  // ≈13.1s cycle
  makeCycleTiming([16, 17, 12]),  // ≈12.5s cycle
  makeCycleTiming([13, 19, 14]),  // ≈12.3s cycle
  makeCycleTiming([18, 12, 15]),  // ≈12.0s cycle
  makeCycleTiming([11, 16, 19]),  // ≈12.3s cycle
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

// ─── Build a free-roaming circuit for one pokemon ────────────────────────────
// Returns path: leg0 (home→enc1) + leg1 (enc1→enc2) + leg2 (enc2→home)
// enc1Tile / enc2Tile are the meeting-point tiles for battle 1 and battle 2
function buildCircuit(rooms, grid, W, H, homeRoomIdx, enc1RoomIdx, enc2RoomIdx, avoidTiles, hardBlocks, legs) {
  const home = rooms[homeRoomIdx];
  const enc1 = rooms[enc1RoomIdx];
  const enc2 = rooms[enc2RoomIdx];

  function buildLeg(sx, sy, ex, ey, wantLen) {
    const full = dijkstraPath(grid, W, H, sx, sy, ex, ey, avoidTiles, hardBlocks);
    // Pad or trim to exact wantLen+1 points
    let leg = [...full];
    while (leg.length < wantLen + 1) leg.unshift({ ...leg[0] });
    if (leg.length > wantLen + 1) leg = leg.slice(leg.length - (wantLen + 1));
    leg.forEach(p => avoidTiles.add(`${p.x},${p.y}`));
    return leg;
  }

  const leg0 = buildLeg(home.cx, home.cy, enc1.cx, enc1.cy, legs[0]);
  const leg1 = buildLeg(enc1.cx, enc1.cy, enc2.cx, enc2.cy, legs[1]);
  const leg2 = buildLeg(enc2.cx, enc2.cy, home.cx, home.cy, legs[2]);

  hardBlocks.add(`${home.cx},${home.cy}`);

  const avgY = [...leg0, ...leg1, ...leg2].reduce((s, p) => s + p.y, 0) /
               (leg0.length + leg1.length + leg2.length);

  return {
    leg0, leg1, leg2,
    enc1Tile: leg0[legs[0]],   // arrival tile at encounter 1
    enc2Tile: leg1[legs[1]],   // arrival tile at encounter 2
    homeTile: leg2[legs[2]],
    avgY,
  };
}

// ─── Build a single free-roaming pokemon's full SMIL animation ───────────────
// circuit = { leg0, leg1, leg2, enc1Tile, enc2Tile }
// opp1 = tile of encounter-1 opponent, opp2 = tile of encounter-2 opponent
// role1 / role2 = 'A' or 'B' for each battle (A strikes in phase 0&2, B in 1&3)
function buildPokemonSVG(pkIdx, delaySec, spriteInfo, cycle, circuit, opp1, opp2, role1, role2) {
  if (!spriteInfo) return { defs: '', svg: '' };

  const { cycleDur, legs, b1s, b1p0e, b1p1e, b1p2e, b1p3e, b1p4e, b1e,
          b2s, b2p0e, b2p1e, b2p2e, b2p3e, b2p4e, b2e, restStart } = cycle;
  const { leg0, leg1, leg2 } = circuit;

  const {
    walkUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
    strkUri, strkSheetW, strkSheetH, strkFrameW, strkFrameH, strkFrameCount, strkDurSec,
    hrtUri,  hrtSheetW,  hrtSheetH,  hrtFrameW,  hrtFrameH,  hrtFrameCount,  hrtDurSec,
    slpUri,  slpSheetW,  slpSheetH,  slpFrameW,  slpFrameH,  slpFrameCount,  slpDurSec,
  } = spriteInfo;

  const SS  = SPRITE_SCALE;
  const dfw = frameW, dfh = frameH;
  const hw  = dfw >> 1, hh = dfh >> 1;

  // ── Build full keyTimes + positions across: leg0 | battle1 | leg1 | battle2 | leg2 | rest ──
  // Each leg contributes (legLen) steps; battle phases hold position at encounter tile; rest at home.
  const [l0, l1, l2] = legs;
  const pixPos = t => `${f1(t.x * TS + TS / 2)},${f1(t.y * TS + TS / 2)}`;

  const allKts = [];
  const allPos = [];
  const allDirRaw = [];  // {from, to} pairs for direction

  const push = (kt, pos, from, to) => { allKts.push(kt); allPos.push(pos); allDirRaw.push({ from, to }); };

  // Helper: add a leg's steps
  function addLeg(leg, startFrac, stepFrac) {
    for (let i = 0; i < leg.length; i++) {
      const kt = startFrac + i * stepFrac;
      const from = leg[i], to = leg[Math.min(i + 1, leg.length - 1)];
      push(kt, pixPos(from), from, to);
    }
  }

  const stepFrac = STEP_DUR / cycleDur;

  // leg0: t=0 → b1s
  addLeg(leg0, 0, stepFrac);
  // battle1 hold at enc1Tile, facing opponent
  const enc1 = circuit.enc1Tile;
  push(b1s,   pixPos(enc1), enc1, opp1);
  push(b1e,   pixPos(enc1), enc1, opp1);
  // leg1: b1e → b2s
  addLeg(leg1, b1e, stepFrac);
  // battle2 hold at enc2Tile
  const enc2 = circuit.enc2Tile;
  push(b2s,   pixPos(enc2), enc2, opp2);
  push(b2e,   pixPos(enc2), enc2, opp2);
  // leg2: b2e → restStart
  addLeg(leg2, b2e, stepFrac);
  // rest at home — keyTime 1.0 closes the loop
  push(1.0, pixPos(circuit.homeTile), circuit.homeTile, circuit.homeTile);

  // Deduplicate + clamp keyTimes (must be strictly ascending, ≤1)
  const merged = [];
  for (let i = 0; i < allKts.length; i++) {
    const kt = Math.min(allKts[i], 1.0);
    if (merged.length > 0 && kt <= merged[merged.length - 1].kt) continue;
    merged.push({ kt, pos: allPos[i], dir: allDirRaw[i] });
  }
  // Ensure last is exactly 1.0
  if (merged[merged.length - 1].kt < 1.0)
    merged.push({ kt: 1.0, ...merged[merged.length - 1] });

  const ktStr  = merged.map(e => f5(e.kt)).join(';');
  const posStr = merged.map(e => e.pos).join(';');

  // Direction rows for walk sprite y-offset
  const dirY = (from, to) => -(hh + dirRow(to.x - from.x, to.y - from.y) * dfh) * SS;
  const allDirY = merged.map(e => dirY(e.dir.from, e.dir.to));

  const clipId = `wc${pkIdx}`;
  let defsStr = `<clipPath id="${clipId}"><rect x="${-hw*SS}" y="${-hh*SS}" width="${dfw*SS}" height="${dfh*SS}"/></clipPath>`;

  // ── Walk sprite — visible except during battles ──────────────────────────────
  const walkXVals = Array.from({ length: frameCount }, (_, f) => -(hw + f * dfw) * SS).join(';');
  // hide during battle1 (b1s→b1e) and battle2 (b2s→b2e) and rest (restStart→1)
  const walkDisplayKt = `0;${f5(b1s)};${f5(b1e)};${f5(b2s)};${f5(b2e)};${f5(restStart)}`;
  const walkDisplayV  = 'inline;none;inline;none;inline;none';
  const walkImg = `<image id="w${pkIdx}" href="${walkUri}"
      x="${-hw*SS}" y="${-hh*SS}" width="${sheetW*SS}" height="${sheetH*SS}" image-rendering="pixelated" clip-path="url(#${clipId})">
    <animate attributeName="x" values="${walkXVals}" dur="${durSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="y" values="${allDirY.join(';')}" keyTimes="${ktStr}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="${walkDisplayV}" keyTimes="${walkDisplayKt}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

  // ── Strike sprites (one per battle) ──────────────────────────────────────────
  let strkImg = '', hrtImg = '', slpImg = '';
  if (strkUri && hrtUri) {
    const adfw = strkFrameW, adfh = strkFrameH;
    const ahw = adfw >> 1, ahh = adfh >> 1;
    const aClipId = `ac${pkIdx}`;
    defsStr += `\n  <clipPath id="${aClipId}"><rect x="${-ahw*SS}" y="${-ahh*SS}" width="${adfw*SS}" height="${adfh*SS}"/></clipPath>`;

    function strkY(encTile, oppTile) {
      const fd = dirRow(oppTile.x - encTile.x, oppTile.y - encTile.y);
      return -(ahh + fd * adfh) * SS;
    }

    const strkXVals = Array.from({ length: strkFrameCount }, (_, f) => -(ahw + f * adfw) * SS).join(';');

    // Role determines which phases this pokemon attacks vs gets hit
    // battle1: role1; battle2: role2
    const b1strkKt = role1 === 'A'
      ? `0;${f5(b1p0e)};${f5(b1p1e)};${f5(b1p2e)};${f5(b1p3e)};1`
      : `0;${f5(b1p1e)};${f5(b1p2e)};${f5(b1p3e)};${f5(b1p4e)};1`;
    const b2strkKt = role2 === 'A'
      ? `0;${f5(b2p0e)};${f5(b2p1e)};${f5(b2p2e)};${f5(b2p3e)};1`
      : `0;${f5(b2p1e)};${f5(b2p2e)};${f5(b2p3e)};${f5(b2p4e)};1`;

    const sy1 = strkY(enc1, opp1), sy2 = strkY(enc2, opp2);

    // We can't change y dynamically between battles with a single image, so we use two images
    const aClipId2 = `ac2_${pkIdx}`;
    defsStr += `\n  <clipPath id="${aClipId2}"><rect x="${-ahw*SS}" y="${-ahh*SS}" width="${adfw*SS}" height="${adfh*SS}"/></clipPath>`;

    strkImg = `<image href="${strkUri}" x="${-ahw*SS}" y="${sy1}" width="${strkSheetW*SS}" height="${strkSheetH*SS}" image-rendering="pixelated" clip-path="url(#${aClipId})">
    <animate attributeName="x" values="${strkXVals}" dur="${strkDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(b1p0e)};${f5(b1e)}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>
  <image href="${strkUri}" x="${-ahw*SS}" y="${sy2}" width="${strkSheetW*SS}" height="${strkSheetH*SS}" image-rendering="pixelated" clip-path="url(#${aClipId2})">
    <animate attributeName="x" values="${strkXVals}" dur="${strkDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(b2p0e)};${f5(b2e)}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

    const hdfw = hrtFrameW, hdfh = hrtFrameH;
    const hhww = hdfw >> 1, hhhh = hdfh >> 1;
    const hClipId = `hc${pkIdx}`;
    const hClipId2 = `hc2_${pkIdx}`;
    defsStr += `\n  <clipPath id="${hClipId}"><rect x="${-hhww*SS}" y="${-hhhh*SS}" width="${hdfw*SS}" height="${hdfh*SS}"/></clipPath>`;
    defsStr += `\n  <clipPath id="${hClipId2}"><rect x="${-hhww*SS}" y="${-hhhh*SS}" width="${hdfw*SS}" height="${hdfh*SS}"/></clipPath>`;

    function hrtDir(encTile, oppTile) {
      return dirRow(oppTile.x - encTile.x, oppTile.y - encTile.y);
    }
    const hrtY1 = -(hhhh + hrtDir(enc1, opp1) * hdfh) * SS;
    const hrtY2 = -(hhhh + hrtDir(enc2, opp2) * hdfh) * SS;
    const hrtXVals = Array.from({ length: hrtFrameCount }, (_, f) => -(hhww + f * hdfw) * SS).join(';');

    const b1hrtKt = role1 === 'A'
      ? `0;${f5(b1p1e)};${f5(b1p2e)};${f5(b1p3e)};${f5(b1p4e)};1`
      : `0;${f5(b1p0e)};${f5(b1p1e)};${f5(b1p2e)};${f5(b1p3e)};1`;
    const b2hrtKt = role2 === 'A'
      ? `0;${f5(b2p1e)};${f5(b2p2e)};${f5(b2p3e)};${f5(b2p4e)};1`
      : `0;${f5(b2p0e)};${f5(b2p1e)};${f5(b2p2e)};${f5(b2p3e)};1`;

    hrtImg = `<image href="${hrtUri}" x="${-hhww*SS}" y="${hrtY1}" width="${hrtSheetW*SS}" height="${hrtSheetH*SS}" image-rendering="pixelated" clip-path="url(#${hClipId})">
    <animate attributeName="x" values="${hrtXVals}" dur="${hrtDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(b1p1e)};${f5(b1e)}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>
  <image href="${hrtUri}" x="${-hhww*SS}" y="${hrtY2}" width="${hrtSheetW*SS}" height="${hrtSheetH*SS}" image-rendering="pixelated" clip-path="url(#${hClipId2})">
    <animate attributeName="x" values="${hrtXVals}" dur="${hrtDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(b2p1e)};${f5(b2e)}" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  // ── Sleep / rest sprite at home ───────────────────────────────────────────────
  if (slpUri) {
    const sfW = slpFrameW, sfH = slpFrameH;
    const shww = sfW >> 1, shhh = sfH >> 1;
    const slpClipId = `sc${pkIdx}`;
    defsStr += `\n  <clipPath id="${slpClipId}"><rect x="${-shww*SS}" y="${-shhh*SS}" width="${sfW*SS}" height="${sfH*SS}"/></clipPath>`;
    const slpXVals = Array.from({ length: slpFrameCount }, (_, f) => -(shww + f * sfW) * SS).join(';');
    slpImg = `<image id="s${pkIdx}" href="${slpUri}"
      x="${-shww*SS}" y="${-shhh*SS}" width="${slpSheetW*SS}" height="${slpSheetH*SS}" image-rendering="pixelated" clip-path="url(#${slpClipId})">
    <animate attributeName="x" values="${slpXVals}" dur="${slpDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(restStart)};1" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  // ── Hit-flash circles for both battles ───────────────────────────────────────
  const fd1 = 0.3 / cycleDur, fd2 = 0.3 / cycleDur;
  const flashImg = `<circle cx="0" cy="0" r="${TS * 0.7}" fill="white" opacity="0">
    <animate attributeName="opacity"
      values="0;0;0.55;0;0;0.55;0;0;0.55;0;0;0.55;0"
      keyTimes="0;${f5(b1p1e)};${f5(b1p1e+fd1)};${f5(b1p2e)};${f5(b1p3e)};${f5(b1p3e+fd1)};${f5(b1p4e)};${f5(b2p1e)};${f5(b2p1e+fd2)};${f5(b2p2e)};${f5(b2p3e)};${f5(b2p3e+fd2)};1"
      dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
  </circle>`;

  // ── Shadow ellipse ────────────────────────────────────────────────────────────
  const shadowY   = f1(hh * SS * 0.42);
  const shadowRx  = f1(dfw * SS * 0.36);
  const shadowRy  = f1(TS * 0.12);
  const shadowYS  = f1(hh * SS * 0.88);
  const shadowRyS = f1(TS * 0.07);
  const shadowEll = `<ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.55)">
    <animate attributeName="cy" values="${shadowY};${shadowYS};${shadowY}" keyTimes="0;${f5(restStart)};1" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="ry" values="${shadowRy};${shadowRyS};${shadowRy}" keyTimes="0;${f5(restStart)};1" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </ellipse>`;

  // ── ZZZ rest bubbles ──────────────────────────────────────────────────────────
  const zx1 = f1(dfw * SS * 0.25), zx2 = f1(dfw * SS * 0.40), zx3 = f1(dfw * SS * 0.55);
  const zy0 = f1(-hh * SS * 0.9);
  const zzzImg = `<g>
    <animate attributeName="display" values="none;inline;none" keyTimes="0;${f5(restStart)};1" dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <text x="${zx1}" font-size="11" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.55)}" dur="1.8s" begin="${delaySec.toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.9;0" dur="1.8s" begin="${delaySec.toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>z</text>
    <text x="${zx2}" font-size="9" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.7)}" dur="1.8s" begin="${(delaySec+0.6).toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.75;0" dur="1.8s" begin="${(delaySec+0.6).toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>z</text>
    <text x="${zx3}" font-size="7" fill="white" font-family="monospace" font-weight="bold" text-anchor="middle">
      <animate attributeName="y" values="${zy0};${f1(-hh*SS*1.9)}" dur="1.8s" begin="${(delaySec+1.2).toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.55;0" dur="1.8s" begin="${(delaySec+1.2).toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>z</text>
  </g>`;

  const svg = `
  <g id="pk${pkIdx}">
    <animateTransform attributeName="transform" type="translate"
      values="${posStr}" keyTimes="${ktStr}"
      dur="${cycleDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    ${shadowEll}
    ${walkImg}
    ${strkImg}
    ${hrtImg}
    ${slpImg}
    ${zzzImg}
    ${flashImg}
  </g>`;

  return { defs: defsStr, svg };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG ...');
  console.log(`  Map: ${MAP_W}x${MAP_H} tiles at ${TS}px`);
  POKEMON_CYCLES.forEach((c, i) => {
    const restFrac = ((1 - c.restStart) * 100).toFixed(0);
    console.log(`  pk${i}: cycleDur=${c.cycleDur.toFixed(2)}s  rest=${restFrac}%`);
  });

  // ── Load sprites ────────────────────────────────────────────────────────────
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

  // ── Download dungeon tileset ─────────────────────────────────────────────────
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

  // ── Generate dungeon ─────────────────────────────────────────────────────────
  const { grid, rooms, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms (${W}x${H} tiles)`);

  // ── Build free-roaming circuits ───────────────────────────────────────────────
  // 6 pokemon, each gets their own home room and 2 encounter rooms.
  // Encounter rooms are deliberately shared so pokemon paths cross each other.
  //
  // 6×2 room grid (COLS=6):
  //   row0: 0  1  2  3  4  5
  //   row1: 6  7  8  9 10 11
  //
  // Assignment: each pokemon homes in one room; enc1 and enc2 are mid-dungeon
  // rooms shared with other pokemon to create natural crossing points.
  const circuits_def = [
    // [homeRoomIdx, enc1RoomIdx, enc2RoomIdx]
    [0,  3,  7],   // pk0: home top-left,  meets at rooms 3 & 7
    [5,  2,  9],   // pk1: home top-right, meets at rooms 2 & 9
    [11, 4,  8],   // pk2: home bot-right, meets at rooms 4 & 8
    [6,  1, 10],   // pk3: home bot-left,  meets at rooms 1 & 10
    [2,  7,  5],   // pk4: home top-mid,   meets at rooms 7 & 5
    [9,  4,  0],   // pk5: home bot-mid,   meets at rooms 4 & 0
  ];

  // For each encounter room, the two pokemon who arrive there become opponents
  // Build a lookup: roomIdx → list of {pkIdx, legIdx (0=enc1,1=enc2)}
  const encRoom = {};  // roomIdx → [pkIdx, ...]
  circuits_def.forEach(([home, e1, e2], pkIdx) => {
    (encRoom[e1] = encRoom[e1] || []).push(pkIdx);
    (encRoom[e2] = encRoom[e2] || []).push(pkIdx);
  });

  const avoidTiles = new Set();
  const hardBlocks = new Set();
  const circuits = circuits_def.map(([home, e1, e2], pkIdx) => {
    const cycle = POKEMON_CYCLES[pkIdx];
    const circ = buildCircuit(rooms, grid, W, H, home, e1, e2, avoidTiles, hardBlocks, cycle.legs);
    console.log(`  pk${pkIdx} ${POKEMON[pkIdx].name}: home=${home} enc1=${e1} enc2=${e2}`);
    return circ;
  });

  // Determine opp1/opp2 tiles and roles for each pokemon per encounter room.
  // For a room R, the two pokemon that arrive there fight each other.
  // The pokemon with lower pkIdx is role 'A' (attacks first).
  function getOpponentInRoom(roomIdx, myPkIdx) {
    const visitors = encRoom[roomIdx] || [];
    const other = visitors.find(p => p !== myPkIdx);
    if (other === undefined) return null;
    return other;
  }

  // Stagger delays: spread pokemon start times by ~2s each for visual variety
  const delays = [0.0, 2.1, 4.3, 6.5, 8.7, 10.9];

  const pkParts = circuits.map((circuit, pkIdx) => {
    const [, enc1RoomIdx, enc2RoomIdx] = circuits_def[pkIdx];

    const opp1Idx = getOpponentInRoom(enc1RoomIdx, pkIdx);
    const opp2Idx = getOpponentInRoom(enc2RoomIdx, pkIdx);

    // Opponent tile = where the OTHER pokemon is at that encounter room
    // If opp is using it as enc1, their enc1Tile; if enc2, their enc2Tile
    function oppTileAt(oppIdx, roomIdx) {
      if (oppIdx === null) return circuit.enc1Tile; // fallback: fight self (hidden)
      const [, o1, o2] = circuits_def[oppIdx];
      return o1 === roomIdx ? circuits[oppIdx].enc1Tile : circuits[oppIdx].enc2Tile;
    }

    const opp1Tile = oppTileAt(opp1Idx, enc1RoomIdx);
    const opp2Tile = oppTileAt(opp2Idx, enc2RoomIdx);

    const role1 = (opp1Idx === null || pkIdx < opp1Idx) ? 'A' : 'B';
    const role2 = (opp2Idx === null || pkIdx < opp2Idx) ? 'A' : 'B';

    return {
      ...buildPokemonSVG(pkIdx, delays[pkIdx], spriteInfos[pkIdx],
                         POKEMON_CYCLES[pkIdx], circuit, opp1Tile, opp2Tile, role1, role2),
      avgY: circuit.avgY,
    };
  });

  // ── Y-sort for correct Z-depth ────────────────────────────────────────────────
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
