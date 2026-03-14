import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { POKEMON_DEFS } from './src/config.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SEED    = 42;
const SVG_W   = 960;
const SVG_H   = 540;
const TS      = 20;           // tile size px
const MAP_W   = SVG_W / TS;  // 48
const MAP_H   = SVG_H / TS;  // 27
const TITLE_H = 28;
const LEG_H   = 22;
// Playfield rows (tile coords) that are safe for dungeon rooms
const ROW_MIN = Math.ceil(TITLE_H / TS);                        // 2
const ROW_MAX = Math.floor((SVG_H - LEG_H) / TS) - 1;          // 24

const POKEMON = Object.values(POKEMON_DEFS);

// Tile type constants
const T = { WALL: 0, FLOOR: 1, CORR: 2, WATER: 3, STAIR: 5, ITEM: 6, TRAP: 7 };

// ─── RNG ──────────────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0x100000000; };
}
const rng = makeRng(SEED * 31337);
const ri  = (lo, hi) => Math.floor(rng() * (hi - lo)) + lo;
const rf  = (lo, hi) => rng() * (hi - lo) + lo;

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
        `<Name>${animName}<\\/Name>[\\s\\S]*?<FrameWidth>(\\d+)<\\/FrameWidth>[\\s\\S]*?<FrameHeight>(\\d+)<\\/FrameHeight>[\\s\\S]*?<Durations>([\\s\\S]*?)<\\/Durations>`
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

// PMD sprite sheet row: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW
function dirRow(dx, dy) {
  if (!dx && !dy) return 0;
  const sec = Math.round((Math.atan2(dy, dx) / (Math.PI / 4) + 8)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][sec];
}

// ─── Dungeon generator ────────────────────────────────────────────────────────
function generateDungeon() {
  const W = MAP_W, H = MAP_H;
  const grid = Array.from({ length: H }, () => new Uint8Array(W)); // all WALL

  // 4 columns × 3 rows of sectors
  const COLS = 4, ROWS = 3;
  const secW = Math.floor(W / COLS);
  const secH = Math.floor((ROW_MAX - ROW_MIN + 1) / ROWS);
  const rooms = [];

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const sx = rx * secW;
      const sy = ROW_MIN + ry * secH;
      const rw = ri(4, secW - 2);
      const rh = ri(3, secH - 1);
      const ox = sx + 1 + ri(0, Math.max(1, secW - rw - 2));
      const oy = sy + 1 + ri(0, Math.max(1, secH - rh - 1));
      for (let y = oy; y < oy + rh && y < H; y++)
        for (let x = ox; x < ox + rw && x < W; x++)
          grid[y][x] = T.FLOOR;
      rooms.push({ x: ox, y: oy, w: rw, h: rh,
                   cx: ox + (rw >> 1), cy: oy + (rh >> 1) });
    }
  }

  // Carve 1-tile-wide L-shaped corridor between two centers
  function carve(ax, ay, bx, by) {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
      if (grid[ay]?.[x] !== undefined && grid[ay][x] === T.WALL) grid[ay][x] = T.CORR;
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++)
      if (grid[y]?.[bx] !== undefined && grid[y][bx] === T.WALL) grid[y][bx] = T.CORR;
  }

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const c = rooms[ry * COLS + rx];
      if (rx + 1 < COLS) { const r = rooms[ry * COLS + rx + 1]; carve(c.cx, c.cy, r.cx, r.cy); }
      if (ry + 1 < ROWS) { const d = rooms[(ry + 1) * COLS + rx]; carve(c.cx, c.cy, d.cx, d.cy); }
    }
  }

  // Water patches in 2 rooms
  for (let i = 0; i < 2; i++) {
    const r = rooms[ri(0, rooms.length)];
    for (let y = r.y + 1; y < r.y + r.h - 1 && y < H; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1 && x < W; x++)
        if (grid[y][x] === T.FLOOR) grid[y][x] = T.WATER;
  }

  // Downstairs in last room; scatter items + traps
  const lr = rooms[rooms.length - 1];
  grid[lr.cy][lr.cx] = T.STAIR;
  let placed = 0;
  for (let a = 0; a < 500 && placed < 6; a++) {
    const tx = ri(0, W), ty = ri(ROW_MIN, ROW_MAX + 1);
    if (grid[ty][tx] === T.FLOOR) { grid[ty][tx] = placed++ < 3 ? T.ITEM : T.TRAP; }
  }

  return { grid, rooms, W, H };
}

// ─── BFS pathfind through walkable dungeon tiles ──────────────────────────────
function bfsPath(grid, W, H, sx, sy, ex, ey) {
  const isWalkable = (x, y) =>
    x >= 0 && x < W && y >= 0 && y < H && grid[y][x] !== T.WALL;

  if (!isWalkable(sx, sy) || !isWalkable(ex, ey))
    return [{ x: sx, y: sy }, { x: ex, y: ey }];

  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const DIRS = [[1,0],[0,1],[-1,0],[0,-1]]; // cardinal only (PMD-authentic corridors)
  const q = [];
  const si = sy * W + sx;
  dist[si] = 0;
  q.push(si);

  outer: for (let qi = 0; qi < q.length; qi++) {
    const idx = q[qi];
    if (idx === ey * W + ex) break outer;
    const cx = idx % W, cy = (idx / W) | 0;
    for (const [ddx, ddy] of DIRS) {
      const nx = cx + ddx, ny = cy + ddy, ni = ny * W + nx;
      if (isWalkable(nx, ny) && dist[ni] === -1) {
        dist[ni] = dist[idx] + 1;
        prev[ni] = idx;
        q.push(ni);
      }
    }
  }

  const path = [];
  let cur = ey * W + ex;
  while (cur !== -1 && cur !== si) { path.push({ x: cur % W, y: (cur / W) | 0 }); cur = prev[cur]; }
  path.push({ x: sx, y: sy });
  return path.reverse();
}

// ─── PMD EoS dungeon tile patterns ────────────────────────────────────────────
function buildTilePatterns(ts) {
  const s = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  const pat = (id, body) =>
    `<pattern id="${id}" x="0" y="0" width="${ts}" height="${ts}" patternUnits="userSpaceOnUse">${body}</pattern>`;

  // PMD EoS blue-purple dungeon palette
  // WALL — very dark purple with slight inner detail
  const wallBody = [
    s(0, 0, ts, ts, '#1E1533'),
    s(1, 1, ts - 2, ts - 2, '#231A3C'),
  ].join('');

  // FLOOR — blue-gray stone with 1px grout borders around each tile
  // Bevel effect: top-left edges lighter, bottom-right edges slightly darker
  const floorBody = [
    s(0, 0, ts, ts, '#404A78'),           // grout / outer border color
    s(1, 1, ts - 2, ts - 2, '#6878A8'),   // main stone fill
    s(1, 1, ts - 2, 1, '#8090C0'),        // top highlight
    s(1, 1, 1, ts - 2, '#8090C0'),        // left highlight
    s(1, ts - 2, ts - 2, 1, '#505888'),   // bottom shadow
    s(ts - 2, 1, 1, ts - 2, '#505888'),   // right shadow
  ].join('');

  // CORRIDOR — slightly darker/more muted than floor
  const corrBody = [
    s(0, 0, ts, ts, '#363E68'),
    s(1, 1, ts - 2, ts - 2, '#505878'),
    s(1, 1, ts - 2, 1, '#606888'),        // top highlight
    s(1, 1, 1, ts - 2, '#606888'),        // left highlight
  ].join('');

  // WATER — PMD blue with shimmer lines
  const waterBody = [
    s(0, 0, ts, ts, '#2A52B8'),
    s(0, Math.round(ts * 0.28), ts, 2, '#4878DC'),
    s(0, Math.round(ts * 0.62), ts, 2, '#4878DC'),
    s(Math.round(ts * 0.10), Math.round(ts * 0.12), Math.round(ts * 0.38), 1, '#80A8F0'),
    s(Math.round(ts * 0.52), Math.round(ts * 0.52), Math.round(ts * 0.38), 1, '#80A8F0'),
  ].join('');

  // STAIR — golden floor with down-arrow
  const stairBody = [
    s(0, 0, ts, ts, '#404A78'),
    s(1, 1, ts - 2, ts - 2, '#907838'),
    s(1, 1, ts - 2, 1, '#C0A848'),
    s(1, 1, 1, ts - 2, '#C0A848'),
    `<polygon points="${ts * 0.50},${ts * 0.78} ${ts * 0.30},${ts * 0.48} ${ts * 0.70},${ts * 0.48}" fill="#503010"/>`,
    s(Math.round(ts * 0.44), Math.round(ts * 0.22), Math.round(ts * 0.12), Math.round(ts * 0.28), '#503010'),
  ].join('');

  // ITEM — blue floor with golden orb
  const itemBody = [
    s(0, 0, ts, ts, '#404A78'),
    s(1, 1, ts - 2, ts - 2, '#6878A8'),
    `<circle cx="${ts * 0.50}" cy="${ts * 0.50}" r="${ts * 0.27}" fill="#FFD040" stroke="#B89020" stroke-width="0.5"/>`,
    `<circle cx="${ts * 0.40}" cy="${ts * 0.40}" r="${ts * 0.09}" fill="white" opacity="0.55"/>`,
  ].join('');

  // TRAP — blue floor with red warning triangle
  const trapBody = [
    s(0, 0, ts, ts, '#404A78'),
    s(1, 1, ts - 2, ts - 2, '#6878A8'),
    `<polygon points="${ts * 0.50},${ts * 0.20} ${ts * 0.80},${ts * 0.76} ${ts * 0.20},${ts * 0.76}" fill="rgba(180,0,0,0.9)" stroke="#600000" stroke-width="0.5"/>`,
    `<text x="${ts * 0.50}" y="${ts * 0.65}" text-anchor="middle" font-size="${Math.round(ts * 0.30)}" fill="white" font-weight="bold">!</text>`,
  ].join('');

  return [
    pat('t-wall', wallBody), pat('t-floor', floorBody), pat('t-corr', corrBody),
    pat('t-water', waterBody), pat('t-stair', stairBody),
    pat('t-item', itemBody), pat('t-trap', trapBody),
  ].join('\n  ');
}

const T_FILL = {
  [T.WALL]: 'url(#t-wall)', [T.FLOOR]: 'url(#t-floor)', [T.CORR]: 'url(#t-corr)',
  [T.WATER]: 'url(#t-water)', [T.STAIR]: 'url(#t-stair)',
  [T.ITEM]: 'url(#t-item)', [T.TRAP]: 'url(#t-trap)',
};

// ─── Dungeon → SVG rects with PMD depth shading ───────────────────────────────
function dungeonToSVG(grid, W, H, ts) {
  const rects = [];
  for (let y = 0; y < H; y++) {
    let run = null;
    for (let x = 0; x < W; x++) {
      const fill = T_FILL[grid[y][x]] ?? 'url(#t-wall)';
      if (run && run.fill === fill) {
        run.w += ts;
      } else {
        if (run) rects.push(run);
        run = { fill, x: x * ts, y: y * ts, w: ts, h: ts };
      }
    }
    if (run) rects.push(run);
  }

  // Depth shading at floor/corridor → wall transitions
  const depth = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      const isOpen = c !== T.WALL;
      // Shadow bar below open tile when wall is beneath (floor appears elevated)
      if (isOpen && y + 1 < H && grid[y + 1][x] === T.WALL) {
        depth.push(`<rect x="${x * ts}" y="${(y + 1) * ts}" width="${ts}" height="4" fill="rgba(0,0,0,0.55)"/>`);
      }
      // Wall front-face: lighter top edge on walls directly below open tiles
      if (c === T.WALL && y > 0 && grid[y - 1][x] !== T.WALL) {
        depth.push(`<rect x="${x * ts}" y="${y * ts}" width="${ts}" height="3" fill="#3A2860"/>`);
      }
    }
  }

  return rects
    .map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w + 0.5}" height="${r.h + 0.5}" fill="${r.fill}"/>`)
    .join('\n') + '\n' + depth.join('\n');
}

// ─── Water shimmer FX ─────────────────────────────────────────────────────────
function waterAnimSVG(grid, W, H, ts) {
  const lines = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== T.WATER) continue;
      const delay = ((x * 3 + y * 7) % 17) * 0.14;
      const cy = ((y + 0.44) * ts).toFixed(1);
      lines.push(
        `<line x1="${((x + 0.15) * ts).toFixed(1)}" y1="${cy}" x2="${((x + 0.85) * ts).toFixed(1)}" y2="${cy}" ` +
        `stroke="white" stroke-width="0.8" class="shimmer" style="animation-delay:${delay.toFixed(2)}s"/>`
      );
    }
  }
  return lines.join('\n');
}

// ─── Build tile-by-tile pokemon animation ─────────────────────────────────────
// Key fix: each tile step = durSec/frameCount (one walk frame per step, like real PMD)
function buildPokemonSVG(idx, def, rooms, grid, W, H, delaySec, spriteInfo) {
  if (!spriteInfo) return { defs: '', svg: '' };

  // Pick 2–3 distinct room waypoints via RNG
  const chosen = [];
  const used   = new Set();
  for (let a = 0; a < 300 && chosen.length < 3; a++) {
    const i = ri(0, rooms.length);
    if (!used.has(i)) { used.add(i); chosen.push(rooms[i]); }
  }

  // BFS stitch between consecutive waypoints
  let onewayPath = [];
  for (let i = 0; i < chosen.length - 1; i++) {
    const a = chosen[i], b = chosen[i + 1];
    const seg = bfsPath(grid, W, H, a.cx, a.cy, b.cx, b.cy);
    if (i > 0 && onewayPath.length > 0) seg.shift(); // no duplicate junction tile
    onewayPath = onewayPath.concat(seg);
  }
  if (onewayPath.length < 2) onewayPath = [{ x: chosen[0].cx, y: chosen[0].cy }, { x: chosen[0].cx + 1, y: chosen[0].cy }];

  // Cap one-way path at 35 tiles so total cycle ≤ ~70 steps
  if (onewayPath.length > 35) onewayPath = onewayPath.slice(0, 35);

  // Round-trip: forward → backward (omit duplicate endpoint)
  const backward = [...onewayPath].reverse().slice(1);
  const fullPath  = [...onewayPath, ...backward];
  const N         = fullPath.length;

  const { walkUri, idleUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
          idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec } = spriteInfo;

  // ── PMD-authentic timing: one walk FRAME per tile step ───────────────────────
  // So the sprite advances by exactly one frame every time it moves one tile.
  const SC       = 1;            // natural sprite size (no upscaling)
  const stepDur  = durSec / frameCount;   // one frame duration
  const totalDur = N * stepDur;           // full loop duration

  // Evenly spaced keyTimes (equal time per tile step)
  const kts   = Array.from({ length: N + 1 }, (_, i) => (i / N).toFixed(5));
  const ktStr = kts.join(';');

  // animateTransform values: SVG pixel center of each tile, closed loop
  const translates = [
    ...fullPath.map(t => `${(t.x * TS + TS / 2).toFixed(1)},${(t.y * TS + TS / 2).toFixed(1)}`),
    `${(fullPath[0].x * TS + TS / 2).toFixed(1)},${(fullPath[0].y * TS + TS / 2).toFixed(1)}`,
  ].join(';');

  const dfw = frameW * SC, dfh = frameH * SC;
  const hw  = dfw >> 1, hh = dfh >> 1;

  // Walk x-animation: cycles all frames at walk speed (matches one step per frame)
  const xVals = Array.from({ length: frameCount }, (_, f) => -(hw + f * dfw)).join(';');

  // Direction y-values for each keyframe (which row of sprite sheet to show)
  // Computed from direction of travel at that tile step
  const dirYVals = fullPath.map((t, i) => {
    const next = fullPath[i + 1] ?? fullPath[0]; // wrap around for last tile
    return -(hh + dirRow(next.x - t.x, next.y - t.y) * dfh);
  });
  dirYVals.push(dirYVals[0]); // closing entry

  const shadowY  = (hh * 0.40).toFixed(1);
  const shadowRx = (dfw * 0.38).toFixed(1);
  const shadowRy = (dfw * 0.09).toFixed(1);
  const nameY    = (hh * 0.62).toFixed(1);

  const clipId  = `clip${idx}`;
  const iClipId = `iclip${idx}`;

  // Clip path defs
  let defsStr = `<clipPath id="${clipId}"><rect x="${-hw}" y="${-hh}" width="${dfw}" height="${dfh}"/></clipPath>`;
  if (idleUri) {
    const ifw = (idleFrameW || frameW) * SC, ifh = (idleFrameH || frameH) * SC;
    defsStr += `\n  <clipPath id="${iClipId}"><rect x="${-(ifw >> 1)}" y="${-(ifh >> 1)}" width="${ifw}" height="${ifh}"/></clipPath>`;
  }

  // Walk image — visible during walk (0–50% and 75–100%), hidden during idle (50–75%)
  const walkDisplay = idleUri
    ? `\n      <animate attributeName="display" values="inline;inline;none;inline" keyTimes="0;0.5;0.75;1" ` +
      `dur="${totalDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>`
    : '';

  const walkImg = `<image href="${walkUri}"
        x="${-hw}" y="${-hh}" width="${sheetW * SC}" height="${sheetH * SC}"
        image-rendering="pixelated" clip-path="url(#${clipId})">
      <animate attributeName="x" values="${xVals}"
        dur="${durSec.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
        calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="y" values="${dirYVals.join(';')}" keyTimes="${ktStr}"
        dur="${totalDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
        calcMode="discrete" repeatCount="indefinite"/>${walkDisplay}
    </image>`;

  // Idle image — shown at 50–75% turnaround point
  let idleImg = '';
  if (idleUri) {
    const ifw = (idleFrameW || frameW) * SC, ifh = (idleFrameH || frameH) * SC;
    const ihw = ifw >> 1, ihh = ifh >> 1;
    const ixVals = Array.from({ length: idleFrameCount }, (_, f) => -(ihw + f * ifw)).join(';');
    idleImg = `
    <image href="${idleUri}"
        x="${-ihw}" y="${-ihh}" width="${(idleSheetW || sheetW) * SC}" height="${(idleSheetH || sheetH) * SC}"
        image-rendering="pixelated" clip-path="url(#${iClipId})">
      <animate attributeName="x" values="${ixVals}"
        dur="${(idleDurSec || durSec).toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
        calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="display" values="none;none;inline;none" keyTimes="0;0.5;0.75;1"
        dur="${totalDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
        calcMode="discrete" repeatCount="indefinite"/>
    </image>`;
  }

  const svg = `
  <g id="pk${idx}">
    <animateTransform attributeName="transform" type="translate"
      values="${translates}" keyTimes="${ktStr}"
      dur="${totalDur.toFixed(3)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.55)"/>
    ${walkImg}${idleImg}
    <text y="${nameY}" text-anchor="middle"
      font-family="'Courier New',monospace" font-size="7"
      fill="white" stroke="black" stroke-width="2" paint-order="stroke">${def.name}</text>
  </g>`;

  return { defs: defsStr, svg };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG …');

  // Load all sprites
  const spriteInfos = POKEMON.map(def => {
    const wp = (def.animations.walk ?? '').replace(/^\.\//, '');
    if (!wp || !existsSync(wp)) { console.warn(`  ⚠ Walk not found: ${wp}`); return null; }
    const anim = parseAnim(wp, 'Walk');
    if (!anim) { console.warn(`  ⚠ No Walk AnimData: ${def.name}`); return null; }
    const { w: sW, h: sH } = pngSize(wp);
    const walkUri = `data:image/png;base64,${readFileSync(wp).toString('base64')}`;
    console.log(`  ✓ ${def.name} Walk ${anim.frameW}×${anim.frameH} ${anim.frameCount}f ${anim.durSec.toFixed(3)}s  stepDur=${(anim.durSec/anim.frameCount).toFixed(3)}s`);

    const ip = (def.animations.idle ?? '').replace(/^\.\//, '');
    let idleUri = null, idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec;
    if (ip && existsSync(ip)) {
      const ia = parseAnim(ip, 'Idle');
      if (ia) {
        const { w: iW, h: iH } = pngSize(ip);
        idleUri = `data:image/png;base64,${readFileSync(ip).toString('base64')}`;
        idleSheetW = iW; idleSheetH = iH;
        idleFrameW = ia.frameW; idleFrameH = ia.frameH;
        idleFrameCount = ia.frameCount; idleDurSec = ia.durSec;
        console.log(`    idle ${ia.frameW}×${ia.frameH} ${ia.frameCount}f`);
      }
    }
    return { walkUri, idleUri, sheetW: sW, sheetH: sH, ...anim,
             idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec };
  });

  // Generate dungeon
  const { grid, rooms, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms`);

  // Build one pokemon per entry, staggered start
  const delays  = POKEMON.map((_, i) => rf(0.5, 3) + i * 1.5);
  const pkParts = POKEMON.map((def, i) =>
    buildPokemonSVG(i, def, rooms, grid, W, H, delays[i], spriteInfos[i])
  );
  const pkDefs = pkParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pkSVGs = pkParts.map(p => p.svg).join('\n');

  const tilePatterns = buildTilePatterns(TS);
  const dungeonSVG   = dungeonToSVG(grid, W, H, TS);
  const waterFX      = waterAnimSVG(grid, W, H, TS);

  // Legend bar
  const legY = SVG_H - LEG_H;
  const legend = POKEMON.map((def, i) => {
    const lx = 10 + i * Math.floor((SVG_W - 20) / POKEMON.length);
    return `<circle cx="${lx + 4}" cy="${legY + 11}" r="4" fill="${def.color}"/>` +
           `<text x="${lx + 11}" y="${legY + 15}" font-family="'Courier New',monospace" font-size="7" fill="#ccc">${def.name}</text>`;
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
<style>
@keyframes shimmer{0%,100%{opacity:.08}50%{opacity:.32}}
.shimmer{animation:shimmer 2.2s ease-in-out infinite}
</style>
<defs>
  <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
    <stop offset="0%"   stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(0,0,12,0.60)"/>
  </radialGradient>
  <linearGradient id="titlegrad" x1="0" x2="1">
    <stop offset="0%"   stop-color="#09091C"/>
    <stop offset="50%"  stop-color="#101840"/>
    <stop offset="100%" stop-color="#09091C"/>
  </linearGradient>
  ${tilePatterns}
  ${pkDefs}
</defs>

<!-- background – same wall colour so edge tiles blend -->
<rect width="${SVG_W}" height="${SVG_H}" fill="#1E1533"/>

<!-- dungeon tilemap -->
<g id="dungeon">${dungeonSVG}</g>

<!-- water shimmer lines -->
<g id="wfx" opacity="0.7">${waterFX}</g>

<!-- pokemon NPCs -->
<g id="npcs">${pkSVGs}</g>

<!-- vignette -->
<rect width="${SVG_W}" height="${SVG_H}" fill="url(#vignette)"/>

<!-- title bar -->
<rect x="0" y="0" width="${SVG_W}" height="${TITLE_H}" fill="url(#titlegrad)" opacity="0.95"/>
<text x="${SVG_W / 2}" y="18" text-anchor="middle"
  font-family="'Courier New',Courier,monospace" font-size="11" font-weight="bold"
  fill="#88DDFF" letter-spacing="2">&#9670; POKEMON MYSTERY DUNGEON WORLD &#9670;</text>
<line x1="0" y1="${TITLE_H}" x2="${SVG_W}" y2="${TITLE_H}" stroke="#1A3060" stroke-width="1"/>

<!-- legend -->
<rect x="0" y="${legY}" width="${SVG_W}" height="${LEG_H}" fill="rgba(0,0,0,0.72)"/>
${legend}

</svg>
`;

  mkdirSync('assets', { recursive: true });
  writeFileSync('assets/pokemon-world.svg', svg, 'utf8');
  console.log(`\u2705  Written assets/pokemon-world.svg  (${(svg.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
