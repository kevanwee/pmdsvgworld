import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { POKEMON_DEFS } from './src/config.js';

// ─── Layout constants ─────────────────────────────────────────────────────────
const SVG_W   = 960;
const SVG_H   = 540;
const TS      = 30;          // tile px — bigger tiles = more visible texture
const MAP_W   = Math.floor(SVG_W / TS);   // 32
const MAP_H   = Math.floor(SVG_H / TS);   // 18
const TITLE_H = 28;
const LEG_H   = 22;
const ROW_MIN = Math.ceil(TITLE_H / TS);                        // 1
const ROW_MAX = Math.floor((SVG_H - LEG_H) / TS) - 1;          // 16

// ─── Battle / movement timing ─────────────────────────────────────────────────
const STEP_DUR     = 0.20;   // seconds per tile  (constant for ALL pokemon)
const WALK_TILES   = 14;     // one-way walk steps before encounter
const PRE_DUR      = 0.20;   // stand facing each other
const PHASE_DUR    = 0.55;   // one attack exchange (attacker + hurt overlap)
const POST_DUR     = 0.20;   // brief disengage pause
const BATTLE_TOTAL = PRE_DUR + 2 * PHASE_DUR + POST_DUR;          // 1.50 s
const PAIR_DUR     = 2 * WALK_TILES * STEP_DUR + BATTLE_TOTAL;    // 2*14*0.2+1.5 = 7.1 s

// Fractional time markers (0–1, with total cycle = PAIR_DUR)
const bs = (WALK_TILES * STEP_DUR) / PAIR_DUR;      // battle start  ≈ 0.394
const t1 = bs  + PRE_DUR   / PAIR_DUR;              // A attacks/B hurts ≈ 0.422
const t2 = t1  + PHASE_DUR / PAIR_DUR;              // B attacks/A hurts ≈ 0.499
const t3 = t2  + PHASE_DUR / PAIR_DUR;              // post-battle idle  ≈ 0.576
const be = t3  + POST_DUR  / PAIR_DUR;              // resume walking    ≈ 0.606

const SEED    = 42;
const POKEMON = Object.values(POKEMON_DEFS);

// Tile type constants
const T = { WALL: 0, FLOOR: 1, CORR: 2, WATER: 3, STAIR: 5, ITEM: 6, TRAP: 7 };

// PMD EoS colour palette (SkyTemple reference)
const C = {
  bgDark:      '#12102A',
  wallInner:   '#1C1838',
  wallFace:    '#302660',   // top-face strip at floor→wall edge
  floorGrout:  '#3C4272',
  floorFill:   '#5A6494',
  floorHi:     '#7888B2',   // top-left bevel
  floorSh:     '#484E7E',   // bottom-right bevel
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
const rf  = (lo, hi) => rng() * (hi - lo) + lo;
const f1  = n => n.toFixed(1);
const f5  = n => n.toFixed(5);

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

// PMD sprite-sheet row: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW
function dirRow(dx, dy) {
  if (!dx && !dy) return 0;
  return [2, 1, 0, 7, 6, 5, 4, 3][Math.round((Math.atan2(dy, dx) / (Math.PI / 4) + 8)) % 8];
}

// ─── Dungeon generator (4×3 sector grid) ──────────────────────────────────────
function generateDungeon() {
  const W = MAP_W, H = MAP_H;
  const grid = Array.from({ length: H }, () => new Uint8Array(W));

  const COLS = 4, ROWS = 3;
  const secW = Math.floor(W / COLS);                          // 8
  const secH = Math.floor((ROW_MAX - ROW_MIN + 1) / ROWS);   // 5
  const rooms = [];

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const sx = rx * secW, sy = ROW_MIN + ry * secH;
      const rw = ri(3, secW - 1);
      const rh = ri(2, secH);
      const ox = sx + 1 + ri(0, Math.max(1, secW - rw - 1));
      const oy = sy + 0 + ri(0, Math.max(1, secH - rh));
      for (let y = oy; y < oy + rh && y < H; y++)
        for (let x = ox; x < ox + rw && x < W; x++)
          grid[y][x] = T.FLOOR;
      rooms.push({ x: ox, y: oy, w: rw, h: rh, cx: ox + (rw >> 1), cy: oy + (rh >> 1) });
    }
  }

  // 1-tile-wide L-shaped corridors
  function carve(ax, ay, bx, by) {
    for (let x = Math.min(ax,bx); x <= Math.max(ax,bx); x++) if (grid[ay]?.[x] === T.WALL) grid[ay][x] = T.CORR;
    for (let y = Math.min(ay,by); y <= Math.max(ay,by); y++) if (grid[y]?.[bx] === T.WALL) grid[y][bx] = T.CORR;
  }
  for (let ry = 0; ry < ROWS; ry++) for (let rx = 0; rx < COLS; rx++) {
    const c = rooms[ry*COLS+rx];
    if (rx+1 < COLS) { const r = rooms[ry*COLS+rx+1]; carve(c.cx, c.cy, r.cx, r.cy); }
    if (ry+1 < ROWS) { const d = rooms[(ry+1)*COLS+rx]; carve(c.cx, c.cy, d.cx, d.cy); }
  }

  // Water in 1 random room
  const wr = rooms[ri(0, rooms.length)];
  for (let y = wr.y+1; y < wr.y+wr.h-1 && y < H; y++)
    for (let x = wr.x+1; x < wr.x+wr.w-1 && x < W; x++)
      if (grid[y][x] === T.FLOOR) grid[y][x] = T.WATER;

  // Stair + scatter items/traps
  const lr = rooms[rooms.length-1];
  grid[lr.cy][lr.cx] = T.STAIR;
  let placed = 0;
  for (let a = 0; a < 500 && placed < 6; a++) {
    const tx = ri(1, W-1), ty = ri(ROW_MIN, ROW_MAX+1);
    if (grid[ty][tx] === T.FLOOR) { grid[ty][tx] = placed++ < 3 ? T.ITEM : T.TRAP; }
  }

  return { grid, rooms, W, H };
}

// ─── BFS (cardinal moves only) ───────────────────────────────────────────────
function bfsPath(grid, W, H, sx, sy, ex, ey) {
  const ok = (x,y) => x>=0&&x<W&&y>=0&&y<H && grid[y][x]!==T.WALL;
  if (!ok(sx,sy)||!ok(ex,ey)) return [{x:sx,y:sy},{x:ex,y:ey}];
  const dist = new Int32Array(W*H).fill(-1);
  const prev = new Int32Array(W*H).fill(-1);
  const q = [sy*W+sx]; dist[sy*W+sx] = 0;
  const DIRS = [[1,0],[0,1],[-1,0],[0,-1]];
  for (let qi=0; qi<q.length; qi++) {
    const idx=q[qi]; if (idx===ey*W+ex) break;
    const cx=idx%W, cy=idx/W|0;
    for (const [dx,dy] of DIRS) {
      const ni=(cy+dy)*W+(cx+dx);
      if (ok(cx+dx,cy+dy)&&dist[ni]===-1) { dist[ni]=dist[idx]+1; prev[ni]=idx; q.push(ni); }
    }
  }
  const path=[]; let cur=ey*W+ex;
  while (cur!==-1) { path.push({x:cur%W,y:cur/W|0}); cur=prev[cur]; }
  return path.reverse();
}

// ─── Per-tile inline rendering (NO SVG <pattern>) ────────────────────────────
// SkyTemple tile logic: each tile drawn as stacked <rect> elements
// Gives full control and avoids pattern rendering issues in any SVG viewer.
function renderTile(tx, ty, type) {
  const r = (x,y,w,h,c,extra='') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${extra}/>`;
  switch (type) {
    case T.WALL:
      return r(tx,ty,TS,TS,C.bgDark) +
             r(tx+1,ty+1,TS-2,TS-2,C.wallInner);

    case T.FLOOR:
      return r(tx,   ty,   TS,   TS,   C.floorGrout) +       // grout border
             r(tx+1, ty+1, TS-2, TS-2, C.floorFill)  +       // main stone
             r(tx+1, ty+1, TS-2, 1,    C.floorHi)    +       // top highlight
             r(tx+1, ty+1, 1,    TS-3, C.floorHi)    +       // left highlight
             r(tx+1, ty+TS-2,TS-2,1,   C.floorSh)    +       // bottom shadow
             r(tx+TS-2,ty+2,1,  TS-3,  C.floorSh);           // right shadow

    case T.CORR:
      return r(tx,   ty,   TS,   TS,   C.corrGrout) +
             r(tx+1, ty+1, TS-2, TS-2, C.corrFill)  +
             r(tx+1, ty+1, TS-2, 1,    C.corrHi)    +
             r(tx+1, ty+1, 1,    TS-3, C.corrHi);

    case T.WATER:
      return r(tx, ty, TS, TS, C.waterFill) +
             r(tx, ty+Math.round(TS*0.28), TS, 2, C.waterShine, ' opacity="0.6"') +
             r(tx, ty+Math.round(TS*0.64), TS, 2, C.waterShine, ' opacity="0.6"');

    case T.STAIR:
      return r(tx,ty,TS,TS,C.floorGrout) +
             r(tx+1,ty+1,TS-2,TS-2,C.stairFill) +
             r(tx+1,ty+1,TS-2,1,C.stairHi) +
             `<rect x="${tx+Math.round(TS*0.43)}" y="${ty+Math.round(TS*0.2)}" width="${Math.round(TS*0.14)}" height="${Math.round(TS*0.36)}" fill="#2A1A06"/>` +
             `<polygon points="${f1(tx+TS*0.5)},${f1(ty+TS*0.82)} ${f1(tx+TS*0.27)},${f1(ty+TS*0.52)} ${f1(tx+TS*0.73)},${f1(ty+TS*0.52)}" fill="#2A1A06"/>`;

    case T.ITEM:
      return r(tx,ty,TS,TS,C.floorGrout) +
             r(tx+1,ty+1,TS-2,TS-2,C.floorFill) +
             `<circle cx="${f1(tx+TS*0.5)}" cy="${f1(ty+TS*0.5)}" r="${f1(TS*0.25)}" fill="${C.itemOrb}" stroke="${C.itemStroke}" stroke-width="0.8"/>` +
             `<circle cx="${f1(tx+TS*0.41)}" cy="${f1(ty+TS*0.41)}" r="${f1(TS*0.08)}" fill="white" opacity="0.55"/>`;

    case T.TRAP:
      return r(tx,ty,TS,TS,C.floorGrout) +
             r(tx+1,ty+1,TS-2,TS-2,C.floorFill) +
             `<polygon points="${f1(tx+TS*0.5)},${f1(ty+TS*0.19)} ${f1(tx+TS*0.81)},${f1(ty+TS*0.77)} ${f1(tx+TS*0.19)},${f1(ty+TS*0.77)}" fill="${C.trapFill}" stroke="#600" stroke-width="0.5"/>` +
             `<text x="${f1(tx+TS*0.5)}" y="${f1(ty+TS*0.65)}" text-anchor="middle" font-size="${Math.round(TS*0.30)}" fill="white" font-weight="bold">!</text>`;

    default:
      return '';
  }
}

function dungeonToSVG(grid, W, H) {
  const tiles = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      tiles.push(renderTile(x*TS, y*TS, grid[y][x]));

  // Wall-face depth strip: lighter purple at top edge of any wall directly below open floor
  const depth = [];
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] === T.WALL && grid[y-1][x] !== T.WALL)
      depth.push(`<rect x="${x*TS}" y="${y*TS}" width="${TS}" height="4" fill="${C.wallFace}"/>`);
    if (grid[y][x] !== T.WALL && grid[y+1]?.[x] === T.WALL)
      depth.push(`<rect x="${x*TS}" y="${(y+1)*TS}" width="${TS}" height="3" fill="rgba(0,0,0,0.45)"/>`);
  }

  return tiles.join('') + depth.join('');
}

function waterAnimSVG(grid, W, H) {
  const lines = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] !== T.WATER) continue;
    const delay = ((x*3+y*7)%17)*0.13;
    const cy = f1((y+0.43)*TS);
    lines.push(`<line x1="${f1((x+0.15)*TS)}" y1="${cy}" x2="${f1((x+0.85)*TS)}" y2="${cy}" stroke="white" stroke-width="0.9" class="wsh" style="animation-delay:${delay.toFixed(2)}s"/>`);
  }
  return lines.join('');
}

// ─── Path building for a battle pair ─────────────────────────────────────────
// Returns { pathA, pathB, eA, eB } where eA/eB are encounter tiles (adjacent).
function buildPairPaths(rooms, grid, W, H, ridxA, ridxB) {
  const rA = rooms[ridxA], rB = rooms[ridxB];
  const full = bfsPath(grid, W, H, rA.cx, rA.cy, rB.cx, rB.cy);
  const K = full.length - 1; // steps
  const m = Math.max(1, K >> 1);

  // Split into A-half and B-half
  let pathA = full.slice(0, m + 1);           // p[0]..p[m], A ends at p[m]
  let pathB = full.slice(m + 1).reverse();    // p[m+1]..p[K] reversed, B ends at p[m+1]

  // Ensure B has at least 2 tiles
  if (pathB.length < 2) pathB = [{ x: full[K].x, y: full[K].y }, { x: full[K].x, y: full[K].y }];

  // Pad / trim to exactly WALK_TILES+1 points (= WALK_TILES steps)
  function normalisePath(path) {
    while (path.length < WALK_TILES + 1) path.unshift({ ...path[0] });
    if (path.length > WALK_TILES + 1) path = path.slice(path.length - (WALK_TILES + 1));
    return path;
  }
  pathA = normalisePath(pathA);
  pathB = normalisePath(pathB);

  return { pathA, pathB, eA: pathA[WALK_TILES], eB: pathB[WALK_TILES] };
}

// ─── Build a single pokemon's full SMIL animation ────────────────────────────
// role: 'A' = attacks first, 'B' = attacked first
function buildPokemonSVG(pkIdx, def, path, eA, eB, role, delaySec, spriteInfo) {
  if (!spriteInfo) return { defs: '', svg: '' };

  const { walkUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
          idleUri, idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec,
          atkUri,  atkSheetW,  atkSheetH,  atkFrameW,  atkFrameH,  atkFrameCount,  atkDurSec,
          hrtUri,  hrtSheetW,  hrtSheetH,  hrtFrameW,  hrtFrameH,  hrtFrameCount,  hrtDurSec } = spriteInfo;

  // Sprite scale: use 2× for small frames so pokemon are clearly visible
  const SC  = frameW <= 36 ? 2 : 1;
  const dfw = frameW * SC, dfh = frameH * SC;
  const hw  = dfw >> 1,    hh  = dfh >> 1;

  // ── keyTimes and positions for animateTransform ──────────────────────────────
  // Full sequence: walk forward (WALK_TILES steps) + hold (battle) + walk backward
  // Total: 2*WALK_TILES+2 keyframe pairs
  const pathRev = [...path].reverse();
  const allKts = [
    ...Array.from({ length: WALK_TILES + 1 }, (_, i) => i * STEP_DUR / PAIR_DUR),
    be,  // hold until battleEnd
    ...Array.from({ length: WALK_TILES }, (_, i) => be + (i + 1) * STEP_DUR / PAIR_DUR),
  ]; // length = 2*WALK_TILES+2

  const pixPos = t => `${f1(t.x*TS + TS/2)},${f1(t.y*TS + TS/2)}`;
  const allPos = [
    ...path.map(pixPos),             // forward walk: WALK_TILES+1 pts
    pixPos(path[WALK_TILES]),        // hold at battleEnd
    ...pathRev.slice(1).map(pixPos), // backward walk: omit first (= hold pos)
  ]; // length = 2*WALK_TILES+2

  const ktStr  = allKts.map(f5).join(';');
  const posStr = allPos.join(';');

  // Walk direction y-values (for the walk sprite row)
  const dirY = (from, to) => -(hh + dirRow(to.x - from.x, to.y - from.y) * dfh);
  const allDirY = [
    // forward walk
    ...Array.from({ length: WALK_TILES + 1 }, (_, i) => {
      const from = path[i], to = path[Math.min(i + 1, WALK_TILES)];
      return dirY(from, to);
    }),
    // hold (face toward opponent – naturally set by last forward step)
    dirY(path[WALK_TILES], { x: (role==='A'?eB:eA).x, y: (role==='A'?eB:eA).y }),
    // backward walk
    ...Array.from({ length: WALK_TILES }, (_, i) => {
      const from = pathRev[i + 1], to = pathRev[Math.min(i + 2, WALK_TILES)];
      return dirY(from, to);
    }),
  ];

  const clipId = `wc${pkIdx}`;
  let defsStr = `<clipPath id="${clipId}"><rect x="${-hw}" y="${-hh}" width="${dfw}" height="${dfh}"/></clipPath>`;

  // ── Walk sprite ──────────────────────────────────────────────────────────────
  const walkXVals = Array.from({ length: frameCount }, (_, f) => -(hw + f * dfw)).join(';');
  const walkImg = `<image id="w${pkIdx}" href="${walkUri}"
      x="${-hw}" y="${-hh}" width="${sheetW*SC}" height="${sheetH*SC}" image-rendering="pixelated" clip-path="url(#${clipId})">
    <animate attributeName="x" values="${walkXVals}" dur="${durSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="y" values="${allDirY.join(';')}" keyTimes="${ktStr}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="inline;none;none;inline" keyTimes="0;${f5(t1)};${f5(t3)};${f5(be)}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

  // ── Attack sprite ─────────────────────────────────────────────────────────────
  let atkImg = '', hrtImg = '';
  if (atkUri && hrtUri) {
    const aSC = atkFrameW <= 36 ? 2 : 1;
    const adfw = atkFrameW * aSC, adfh = atkFrameH * aSC;
    const ahw  = adfw >> 1, ahh = adfh >> 1;
    const aClipId = `ac${pkIdx}`;
    defsStr += `\n  <clipPath id="${aClipId}"><rect x="${-ahw}" y="${-ahh}" width="${adfw}" height="${adfh}"/></clipPath>`;

    // Attacker faces toward opponent; we compute row based on role
    const atkRow = dirRow(
      (role==='A' ? eB.x - eA.x : eA.x - eB.x),
      (role==='A' ? eB.y - eA.y : eA.y - eB.y)
    );
    const atkY = -(ahh + atkRow * adfh);
    const atkXVals = Array.from({ length: atkFrameCount }, (_, f) => -(ahw + f * adfw)).join(';');
    // A attacks during t1→t2, B attacks during t2→t3
    const atkShow = role === 'A' ? `0;${f5(t1)};${f5(t2)}` : `0;${f5(t2)};${f5(t3)}`;

    atkImg = `<image id="a${pkIdx}" href="${atkUri}"
      x="${-ahw}" y="${atkY}" width="${atkSheetW*aSC}" height="${atkSheetH*aSC}" image-rendering="pixelated" clip-path="url(#${aClipId})">
    <animate attributeName="x" values="${atkXVals}" dur="${atkDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="${atkShow}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;

    // ── Hurt sprite ──────────────────────────────────────────────────────────────
    const hSC = hrtFrameW <= 36 ? 2 : 1;
    const hdfw = hrtFrameW * hSC, hdfh = hrtFrameH * hSC;
    const hhw  = hdfw >> 1, hhh = hdfh >> 1;
    const hClipId = `hc${pkIdx}`;
    defsStr += `\n  <clipPath id="${hClipId}"><rect x="${-hhw}" y="${-hhh}" width="${hdfw}" height="${hdfh}"/></clipPath>`;

    // Hurt pokemon faces toward attacker
    const hrtRow = dirRow(
      (role==='A' ? eB.x - eA.x : eA.x - eB.x),
      (role==='A' ? eB.y - eA.y : eA.y - eB.y)
    );
    const hrtY = -(hhh + hrtRow * hdfh);
    const hrtXVals = Array.from({ length: hrtFrameCount }, (_, f) => -(hhw + f * hdfw)).join(';');
    // A is hurt when B attacks (t2→t3), B is hurt when A attacks (t1→t2)
    const hrtShow = role === 'A' ? `0;${f5(t2)};${f5(t3)}` : `0;${f5(t1)};${f5(t2)}`;

    hrtImg = `<image id="h${pkIdx}" href="${hrtUri}"
      x="${-hhw}" y="${hrtY}" width="${hrtSheetW*hSC}" height="${hrtSheetH*hSC}" image-rendering="pixelated" clip-path="url(#${hClipId})">
    <animate attributeName="x" values="${hrtXVals}" dur="${hrtDurSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    <animate attributeName="display" values="none;inline;none" keyTimes="${hrtShow}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
  </image>`;
  }

  // Shadow ellipse + name plate geometry
  const shadowY  = f1(hh * 0.42);
  const shadowRx = f1(dfw * 0.36);
  const shadowRy = f1(TS  * 0.12);
  const nameY    = f1(-hh - 3);

  // ── Battle hit-flash effect at encounter tile ──────────────────────────────
  // A's attack flash (at opponent's position → relative coords from eA perspective):
  const flashSelf = role === 'A' ? `0;${f5(t1)};${f5(t1+0.06)};${f5(t2)}` : `0;${f5(t2)};${f5(t2+0.06)};${f5(t3)}`;
  const flashImg = `<circle cx="0" cy="0" r="${TS*0.7}" fill="white" opacity="0">
    <animate attributeName="opacity" values="0;0;0.6;0" keyTimes="${flashSelf}" dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="linear" repeatCount="indefinite"/>
  </circle>`;

  const svg = `
  <g id="pk${pkIdx}">
    <animateTransform attributeName="transform" type="translate"
      values="${posStr}" keyTimes="${ktStr}"
      dur="${PAIR_DUR.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.55)"/>
    ${walkImg}
    ${atkImg}
    ${hrtImg}
    ${flashImg}
    <text y="${nameY}" text-anchor="middle"
      font-family="'Courier New',monospace" font-size="7" font-weight="bold"
      fill="white" stroke="${def.color}" stroke-width="2.5" paint-order="stroke">${def.name}</text>
  </g>`;

  return { defs: defsStr, svg };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG …');

  // Load sprites: walk + idle + attack + hurt
  const spriteInfos = POKEMON.map(def => {
    const wp = (def.animations.walk ?? '').replace(/^\.\//, '');
    if (!wp || !existsSync(wp)) { console.warn(`  ⚠ Walk missing: ${def.name}`); return null; }
    const wa = parseAnim(wp, 'Walk'); if (!wa) { console.warn(`  ⚠ No Walk AnimData: ${def.name}`); return null; }
    const { w:sW, h:sH } = pngSize(wp);
    const walkUri = `data:image/png;base64,${readFileSync(wp).toString('base64')}`;
    console.log(`  ✓ ${def.name}  Walk ${wa.frameW}×${wa.frameH}  ${wa.frameCount}f`);

    function loadAnim(animKey, xmlName) {
      const p = (def.animations[animKey] ?? '').replace(/^\.\//, '');
      if (!p || !existsSync(p)) { console.warn(`    ⚠ ${xmlName} missing for ${def.name}`); return null; }
      const a = parseAnim(p, xmlName); if (!a) return null;
      const { w, h } = pngSize(p);
      const uri = `data:image/png;base64,${readFileSync(p).toString('base64')}`;
      console.log(`    ${xmlName}: ${a.frameW}×${a.frameH}  ${a.frameCount}f`);
      return { uri, sheetW: w, sheetH: h, ...a };
    }

    const id = loadAnim('idle',   'Idle');
    const at = loadAnim('attack', 'Attack');
    const hr = loadAnim('hurt',   'Hurt');

    return {
      walkUri, sheetW: sW, sheetH: sH, ...wa,
      idleUri:       id?.uri,   idleSheetW:   id?.sheetW,  idleSheetH:   id?.sheetH,
      idleFrameW:    id?.frameW, idleFrameH:  id?.frameH,  idleFrameCount:id?.frameCount, idleDurSec:id?.durSec,
      atkUri:        at?.uri,   atkSheetW:    at?.sheetW,  atkSheetH:    at?.sheetH,
      atkFrameW:     at?.frameW, atkFrameH:   at?.frameH,  atkFrameCount: at?.frameCount, atkDurSec: at?.durSec,
      hrtUri:        hr?.uri,   hrtSheetW:    hr?.sheetW,  hrtSheetH:    hr?.sheetH,
      hrtFrameW:     hr?.frameW, hrtFrameH:   hr?.frameH,  hrtFrameCount: hr?.frameCount, hrtDurSec: hr?.durSec,
    };
  });

  // Generate dungeon
  const { grid, rooms, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms (${W}×${H} tiles)`);

  // ── Pair up pokemon: (0,1), (2,3), (4,5) ─────────────────────────────────
  // Pick room indices far apart for each pair to give interesting paths
  const pairRoomIdxs = [
    [0, rooms.length-1],
    [2, rooms.length-3],
    [1, rooms.length-2],
  ];

  const pkParts = [];
  // Stagger pair start times so battles don't all happen simultaneously
  const pairDelays = [0.5, PAIR_DUR * 0.34, PAIR_DUR * 0.68];

  for (let pairIdx = 0; pairIdx < 3; pairIdx++) {
    const [ridxA, ridxB] = pairRoomIdxs[pairIdx];
    const { pathA, pathB, eA, eB } = buildPairPaths(rooms, grid, W, H, ridxA, ridxB);
    const delay = pairDelays[pairIdx];

    const idxA = pairIdx * 2;
    const idxB = pairIdx * 2 + 1;
    const defA = POKEMON[idxA], defB = POKEMON[idxB];

    pkParts.push(buildPokemonSVG(idxA, defA, pathA, eA, eB, 'A', delay,          spriteInfos[idxA]));
    pkParts.push(buildPokemonSVG(idxB, defB, pathB, eA, eB, 'B', delay,          spriteInfos[idxB]));
  }

  const pkDefs = pkParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pkSVGs = pkParts.map(p => p.svg).join('\n');

  const dungeonSVG = dungeonToSVG(grid, W, H);
  const waterFX    = waterAnimSVG(grid, W, H);

  // Legend
  const legY = SVG_H - LEG_H;
  const legend = POKEMON.map((def, i) => {
    const lx = 10 + i * Math.floor((SVG_W - 20) / POKEMON.length);
    return `<circle cx="${lx+4}" cy="${legY+11}" r="4" fill="${def.color}"/>` +
           `<text x="${lx+11}" y="${legY+15}" font-family="'Courier New',monospace" font-size="7" fill="#ccc">${def.name}</text>`;
  }).join('');

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
  <linearGradient id="titlegrad" x1="0" x2="1">
    <stop offset="0%"  stop-color="#080818"/>
    <stop offset="50%" stop-color="#0E163A"/>
    <stop offset="100%" stop-color="#080818"/>
  </linearGradient>
  ${pkDefs}
</defs>

<!-- ── full-canvas background matches wall colour ── -->
<rect width="${SVG_W}" height="${SVG_H}" fill="${C.bgDark}"/>

<!-- ── dungeon tiles (inline rects, no SVG pattern) ── -->
<g id="dungeon">${dungeonSVG}</g>

<!-- ── water shimmer CSS lines ── -->
<g id="wfx" opacity="0.75">${waterFX}</g>

<!-- ── pokemon NPCs + battle animations ── -->
<g id="npcs">${pkSVGs}</g>

<!-- ── vignette ── -->
<rect width="${SVG_W}" height="${SVG_H}" fill="url(#vignette)" pointer-events="none"/>

<!-- ── title bar ── -->
<rect x="0" y="0" width="${SVG_W}" height="${TITLE_H}" fill="url(#titlegrad)" opacity="0.96"/>
<text x="${SVG_W/2}" y="18" text-anchor="middle"
  font-family="'Courier New',Courier,monospace" font-size="11" font-weight="bold"
  fill="#88DDFF" letter-spacing="2">&#9670; POKEMON MYSTERY DUNGEON WORLD &#9670;</text>
<line x1="0" y1="${TITLE_H}" x2="${SVG_W}" y2="${TITLE_H}" stroke="#1A3060" stroke-width="1"/>

<!-- ── legend ── -->
<rect x="0" y="${legY}" width="${SVG_W}" height="${LEG_H}" fill="rgba(0,0,0,0.76)"/>
${legend}

</svg>
`;

  mkdirSync('assets', { recursive: true });
  writeFileSync('assets/pokemon-world.svg', svg, 'utf8');
  console.log(`\u2705  Written assets/pokemon-world.svg  (${(svg.length/1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
