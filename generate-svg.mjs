import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { POKEMON_DEFS } from './src/config.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const SEED     = 42;
const SVG_W    = 960;
const SVG_H    = 540;
const TS       = 20;          // tile size in SVG px
const MAP_W    = SVG_W / TS;  // 48
const MAP_H    = SVG_H / TS;  // 27
const TITLE_H  = 28;
const LEG_H    = 22;
const PLAY_Y   = TITLE_H;               // playfield top
const PLAY_H   = SVG_H - TITLE_H - LEG_H; // playfield height

const POKEMON  = Object.values(POKEMON_DEFS);

// Tile type enum
const T = { WALL: 0, FLOOR: 1, CORR: 2, WATER: 3, STAIR: 5, ITEM: 6, TRAP: 7 };

// ─── Seeded RNG ───────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0x100000000;
  };
}
const rng = makeRng(SEED * 31337);
const ri  = (min, max) => Math.floor(rng() * (max - min)) + min;
const rf  = (lo, hi)   => rng() * (hi - lo) + lo;
const fmt1 = n => n.toFixed(1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Sprite helpers ───────────────────────────────────────────────────────────
function pngSize(filePath) {
  const buf = readFileSync(filePath);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function parseAnim(walkPngPath, animName) {
  let dir = dirname(walkPngPath);
  for (let i = 0; i < 5; i++) {
    const xmlPath = join(dir, 'AnimData.xml');
    if (existsSync(xmlPath)) {
      const xml = readFileSync(xmlPath, 'utf8');
      const pat = new RegExp(
        `<Name>${animName}<\\/Name>[\\s\\S]*?<FrameWidth>(\\d+)<\\/FrameWidth>[\\s\\S]*?<FrameHeight>(\\d+)<\\/FrameHeight>[\\s\\S]*?<Durations>([\\s\\S]*?)<\\/Durations>`
      );
      const m = xml.match(pat);
      if (m) {
        const frameW = +m[1], frameH = +m[2];
        const durs = [...m[3].matchAll(/<Duration>(\d+)<\/Duration>/g)];
        const frameCount  = durs.length;
        const totalTicks  = durs.reduce((s, d) => s + +d[1], 0);
        return { frameW, frameH, frameCount, durSec: totalTicks / 60 };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// PMD row order: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW
function dirRow(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const ang    = Math.atan2(dy, dx);
  const sector = Math.round((ang / (Math.PI / 4) + 8)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][sector];
}

// ─── Dungeon generator ────────────────────────────────────────────────────────
function generateDungeon() {
  const W = MAP_W, H = MAP_H;
  const grid = Array.from({ length: H }, () => new Uint8Array(W));  // all WALL=0

  // Title bar + legend strip are HUD; We offset the dungeon inside the playfield.
  // In tile coords: row 0..1 = title, row 25..26 = legend.
  // Keep rooms inside rows 2..24 (inclusive) to stay within playfield.
  const ROW_MIN = Math.ceil(TITLE_H / TS);           // 2
  const ROW_MAX = Math.floor((SVG_H - LEG_H) / TS) - 1; // 24

  // 4 columns × 3 rows of sectors
  const COLS = 4, ROWS = 3;
  const secW  = Math.floor(W / COLS);       // 12
  const secH  = Math.floor((ROW_MAX - ROW_MIN + 1) / ROWS); // ~7
  const rooms = [];

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const sx = rx * secW;
      const sy = ROW_MIN + ry * secH;

      const margin = 1;
      const rw = ri(4, secW - margin * 2 - 1);
      const rh = ri(3, secH - margin * 2);

      const ox = sx + margin + ri(0, secW - margin * 2 - rw);
      const oy = sy + margin + ri(0, secH - margin * 2 - rh);

      for (let y = oy; y < oy + rh; y++) {
        for (let x = ox; x < ox + rw; x++) {
          if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = T.FLOOR;
        }
      }
      rooms.push({ x: ox, y: oy, w: rw, h: rh,
                   cx: ox + Math.floor(rw / 2),
                   cy: oy + Math.floor(rh / 2) });
    }
  }

  // L-shaped corridors: connect each room to the one to its right, and the one below
  function carve(ax, ay, bx, by) {
    // horizontal then vertical
    const mx = ax < bx ? ax : bx;
    for (let x = mx; x <= Math.max(ax, bx); x++) {
      if (ay >= 0 && ay < H && x >= 0 && x < W) grid[ay][x] = T.CORR;
    }
    const my = ay < by ? ay : by;
    for (let y = my; y <= Math.max(ay, by); y++) {
      if (y >= 0 && y < H && bx >= 0 && bx < W) grid[y][bx] = T.CORR;
    }
  }

  for (let ry = 0; ry < ROWS; ry++) {
    for (let rx = 0; rx < COLS; rx++) {
      const cur = rooms[ry * COLS + rx];
      if (rx + 1 < COLS) {
        const right = rooms[ry * COLS + rx + 1];
        carve(cur.cx, cur.cy, right.cx, right.cy);
      }
      if (ry + 1 < ROWS) {
        const below = rooms[(ry + 1) * COLS + rx];
        carve(cur.cx, cur.cy, below.cx, below.cy);
      }
    }
  }

  // Water patches in up to 2 rooms
  const waterRooms = [ri(0, rooms.length), ri(0, rooms.length)];
  for (const ri2 of waterRooms) {
    const r = rooms[ri2];
    const wsx = r.x + 1, wsy = r.y + 1;
    const wwx = Math.max(1, r.w - 2), wwy = Math.max(1, r.h - 2);
    for (let y = wsy; y < wsy + wwy && y < H; y++) {
      for (let x = wsx; x < wsx + wwx && x < W; x++) {
        if (grid[y][x] === T.FLOOR) grid[y][x] = T.WATER;
      }
    }
  }

  // Stair in last room
  const lr = rooms[rooms.length - 1];
  grid[lr.cy][lr.cx] = T.STAIR;

  // 6 items/traps scattered in floor tiles
  let placed = 0;
  for (let attempt = 0; attempt < 500 && placed < 6; attempt++) {
    const rx2 = ri(0, W), ry2 = ri(0, H);
    if (grid[ry2][rx2] === T.FLOOR) {
      grid[ry2][rx2] = placed < 3 ? T.ITEM : T.TRAP;
      placed++;
    }
  }

  // Collect walkable cells (floor + corr)
  const floorCells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] === T.FLOOR || grid[y][x] === T.CORR) {
        floorCells.push({ x, y });
      }
    }
  }

  return { grid, rooms, floorCells, W, H };
}

// ─── Tile patterns ────────────────────────────────────────────────────────────
function buildTilePatterns(ts) {
  const s = (x, y, w, h, c) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;

  function pat(id, body) {
    return `<pattern id="${id}" x="0" y="0" width="${ts}" height="${ts}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  }

  // WALL — dark navy with subtle brick grid
  const wallBody = [
    s(0, 0, ts, ts, '#1A1A2E'),
    s(0, 0, ts, 1, '#0D0D1A'),
    s(0, 0, 1, ts, '#0D0D1A'),
    s(1, 1, ts/2 - 2, ts/2 - 2, '#222238'),
    s(ts/2, ts/2, ts/2 - 1, ts/2 - 1, '#222238'),
    s(ts/2 + 2, 3, 2, 2, '#2A2A44'),
    s(4, ts/2 + 3, 2, 2, '#2A2A44'),
  ].join('');

  // FLOOR — warm tan stone with 2×2 grout grid
  const floorBody = [
    s(0, 0, ts, ts, '#8B7D6B'),
    s(0, 0, ts, 1, '#6B5E50'),
    s(0, 0, 1, ts, '#6B5E50'),
    s(ts/2, 0, 1, ts, '#6B5E50'),
    s(0, ts/2, ts, 1, '#6B5E50'),
    s(2, 2, ts/2 - 3, ts/2 - 3, '#9B8D7B'),
    s(ts/2 + 2, 2, ts/2 - 3, ts/2 - 3, '#9B8D7B'),
    s(2, ts/2 + 2, ts/2 - 3, ts/2 - 3, '#9B8D7B'),
    s(ts/2 + 2, ts/2 + 2, ts/2 - 3, ts/2 - 3, '#9B8D7B'),
  ].join('');

  // CORRIDOR — darker stone
  const corrBody = [
    s(0, 0, ts, ts, '#6B5E50'),
    s(0, 0, ts, 1, '#5A4E42'),
    s(0, 0, 1, ts, '#5A4E42'),
    s(2, 2, ts - 4, ts - 4, '#7A6D5E'),
  ].join('');

  // WATER — PMD-style blue shimmer
  const waterBody = [
    s(0, 0, ts, ts, '#1A5CC8'),
    s(0, 0, ts, 1, '#1040A0'),
    s(0, ts * 0.3, ts, 2, '#4484E8'),
    s(0, ts * 0.7, ts, 2, '#4484E8'),
    s(ts * 0.15, ts * 0.15, ts * 0.3, 1, '#6FA8F0'),
    s(ts * 0.55, ts * 0.55, ts * 0.3, 1, '#6FA8F0'),
  ].join('');

  // STAIR — yellow floor tile with ↓ arrow
  const stairBody = [
    floorBody,
    s(ts * 0.3, ts * 0.2, ts * 0.4, ts * 0.6, '#F0D000'),
    s(ts * 0.2, ts * 0.6, ts * 0.6, ts * 0.2, '#F0D000'),
    `<polygon points="${ts*0.5},${ts*0.85} ${ts*0.25},${ts*0.6} ${ts*0.75},${ts*0.6}" fill="#C8A800"/>`,
  ].join('');

  // ITEM — floor with gold orb
  const itemBody = [
    floorBody,
    `<circle cx="${ts*0.5}" cy="${ts*0.5}" r="${ts*0.28}" fill="#FFD700" stroke="#C8A800" stroke-width="1"/>`,
    `<circle cx="${ts*0.42}" cy="${ts*0.42}" r="${ts*0.08}" fill="white" opacity="0.6"/>`,
  ].join('');

  // TRAP — floor with red triangle
  const trapBody = [
    floorBody,
    `<polygon points="${ts*0.5},${ts*0.18} ${ts*0.82},${ts*0.76} ${ts*0.18},${ts*0.76}" fill="rgba(200,0,0,0.8)" stroke="#800000" stroke-width="1"/>`,
    `<text x="${ts*0.5}" y="${ts*0.65}" text-anchor="middle" font-size="${ts*0.32}" fill="white">!</text>`,
  ].join('');

  return [
    pat('t-wall',  wallBody),
    pat('t-floor', floorBody),
    pat('t-corr',  corrBody),
    pat('t-water', waterBody),
    pat('t-stair', stairBody),
    pat('t-item',  itemBody),
    pat('t-trap',  trapBody),
  ].join('\n  ');
}

const T_FILL = {
  [T.WALL]:  'url(#t-wall)',
  [T.FLOOR]: 'url(#t-floor)',
  [T.CORR]:  'url(#t-corr)',
  [T.WATER]: 'url(#t-water)',
  [T.STAIR]: 'url(#t-stair)',
  [T.ITEM]:  'url(#t-item)',
  [T.TRAP]:  'url(#t-trap)',
};

// ─── Dungeon → SVG rects ──────────────────────────────────────────────────────
function dungeonToSVG(grid, W, H, ts) {
  const rows  = [];
  for (let y = 0; y < H; y++) {
    let run = null;
    for (let x = 0; x < W; x++) {
      const fill = T_FILL[grid[y][x]] ?? 'url(#t-wall)';
      if (run && run.fill === fill) {
        run.w += ts;
      } else {
        if (run) rows.push(run);
        run = { fill, x: x * ts, y: y * ts, w: ts, h: ts };
      }
    }
    if (run) rows.push(run);
  }

  // Wall-shadow stripes: thin dark bar below each floor→wall transition
  const shadows = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const cur  = grid[y][x];
      const below = grid[y + 1][x];
      if ((cur === T.FLOOR || cur === T.CORR) && below === T.WALL) {
        shadows.push(
          `<rect x="${x * ts}" y="${(y + 1) * ts}" width="${ts}" height="3" fill="rgba(0,0,0,0.4)"/>`
        );
      }
    }
  }

  return rows
    .map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w + 0.5}" height="${r.h + 0.5}" fill="${r.fill}"/>`)
    .join('\n') + '\n' + shadows.join('\n');
}

// ─── Water shimmer animation ──────────────────────────────────────────────────
function waterAnimSVG(grid, W, H, ts) {
  const lines = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== T.WATER) continue;
      const delay = ((x * 3 + y * 7) % 17) * 0.15;
      const cy    = fmt1((y + 0.45) * ts);
      lines.push(
        `<line x1="${fmt1((x + 0.15) * ts)}" y1="${cy}" x2="${fmt1((x + 0.85) * ts)}" y2="${cy}" ` +
        `stroke="white" stroke-width="0.8" class="shimmer" style="animation-delay:${delay.toFixed(2)}s"/>`
      );
    }
  }
  return lines.join('\n');
}

// ─── Pick room-to-room path ───────────────────────────────────────────────────
function generateRoomPath(rooms, count = 3) {
  const chosen = [];
  const used   = new Set();
  for (let attempt = 0; attempt < 200 && chosen.length < count; attempt++) {
    const idx = ri(0, rooms.length);
    if (!used.has(idx)) { used.add(idx); chosen.push(rooms[idx]); }
  }
  return chosen.map(r => ({
    x: clamp((r.cx + 0.5) * TS, 0, SVG_W),
    y: clamp((r.cy + 0.5) * TS, PLAY_Y + 4, PLAY_Y + PLAY_H - 4),
  }));
}

// ─── Pokemon sprite element using <animateTransform> ─────────────────────────
function buildPokemonSVG(idx, def, pts, totalDurSec, delaySec, spriteInfo) {
  if (!pts || pts.length < 2) return { defs: '', svg: '' };

  // Build round-trip waypoints: forward + backward
  const fwd = pts;
  const bwd = [...pts].reverse();
  const full = [...fwd, ...bwd];       // length = 2*n, last point = first point repeated after

  // Compute per-segment distances for distance-proportional keyTimes
  const segs = [];
  for (let i = 0; i < full.length - 1; i++) {
    const dx = full[i + 1].x - full[i].x;
    const dy = full[i + 1].y - full[i].y;
    segs.push(Math.hypot(dx, dy) + 0.01);  // +0.01 avoids zero-distance stalls
  }
  const totalDist = segs.reduce((a, b) => a + b, 0);
  const kts = [0];
  let cumulative = 0;
  for (const d of segs) {
    cumulative += d;
    kts.push(cumulative / totalDist);
  }
  kts[kts.length - 1] = 1;  // clamp
  const ktStr = kts.map(v => v.toFixed(4)).join(';');

  // animateTransform values (closing the loop back to start)
  const translates = [...full, full[0]].map(p => `${fmt1(p.x)},${fmt1(p.y)}`).join(';');

  // Direction row at each keyframe (based on motion direction for that segment)
  let defsStr = '';
  let bodyStr = '';

  if (spriteInfo) {
    const { walkUri, idleUri,
            sheetW, sheetH, frameW, frameH, frameCount, durSec,
            idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec } = spriteInfo;

    const SC   = 2;
    const dfw  = frameW * SC;
    const dfh  = frameH * SC;
    const hw   = dfw / 2;
    const hh   = dfh / 2;

    const clipId  = `clip${idx}`;
    const iClipId = `iclip${idx}`;

    defsStr = `<clipPath id="${clipId}"><rect x="${-hw}" y="${-hh}" width="${dfw}" height="${dfh}"/></clipPath>`;
    if (idleUri) {
      const ifw = idleFrameW * SC, ifh = idleFrameH * SC;
      defsStr += `\n  <clipPath id="${iClipId}"><rect x="${-(ifw/2)}" y="${-(ifh/2)}" width="${ifw}" height="${ifh}"/></clipPath>`;
    }

    // Walk frame x-animation
    const xVals = Array.from({ length: frameCount }, (_, f) => -hw - f * dfw).join(';');

    // Direction y-values at each keyframe
    // full has n+1 points for n+1 keyTimes (the last kts=1 closes loop)
    const dirYVals = [];
    for (let i = 0; i < full.length; i++) {
      let dx = 0, dy = 0;
      if (i < full.length - 1) {
        dx = full[i + 1].x - full[i].x;
        dy = full[i + 1].y - full[i].y;
      } else {
        dx = full[1].x - full[0].x;  // loop back direction
        dy = full[1].y - full[0].y;
      }
      const row = dirRow(dx, dy);
      dirYVals.push(-hh - row * dfh);
    }
    // closing value = same as first
    dirYVals.push(dirYVals[0]);
    const dirYStr = dirYVals.join(';');
    // keyTimes for direction: same as kts, plus closing 1
    const dirKtStr = kts.join(';') + ';1';

    const shadowY  = fmt1(hh * 0.35);
    const shadowRx = fmt1(dfw * 0.36);
    const shadowRy = fmt1(dfw * 0.07);
    const nameY    = fmt1(hh * 0.55);

    // Walk image
    let walkImg = `<image href="${walkUri}"
        x="${-hw}" y="${-hh}"
        width="${sheetW * SC}" height="${sheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${clipId})">
      <animate attributeName="x" values="${xVals}" dur="${durSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="y" values="${dirYStr}" keyTimes="${dirKtStr}" dur="${totalDurSec.toFixed(2)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>`;

    // Idle toggle: show idle at 75-100% of each cycle, hide walk at that point
    if (idleUri) {
      walkImg += `
      <animate attributeName="display" values="inline;inline;none;inline" keyTimes="0;0.5;0.75;1" dur="${totalDurSec.toFixed(2)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>`;
    }
    walkImg += `\n    </image>`;

    let idleImg = '';
    if (idleUri) {
      const ifw = idleFrameW * SC, ifh = idleFrameH * SC;
      const ixVals = Array.from({ length: idleFrameCount }, (_, f) => -(ifw / 2) - f * ifw).join(';');
      // idle row = idle direction = same dirRow at 75% mark → use row 0 (south/idle)
      const idleRow = 0;
      idleImg = `
    <image href="${idleUri}"
        x="${-(ifw/2)}" y="${-(ifh/2) - idleRow * ifh}"
        width="${idleSheetW * SC}" height="${idleSheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${iClipId})">
      <animate attributeName="x" values="${ixVals}" dur="${idleDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="display" values="none;none;inline;none" keyTimes="0;0.5;0.75;1" dur="${totalDurSec.toFixed(2)}s" begin="${delaySec.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>`;
    }

    bodyStr = `
  <g id="pkmn${idx}">
    <animateTransform attributeName="transform" type="translate"
      values="${translates}" keyTimes="${ktStr};1"
      dur="${totalDurSec.toFixed(2)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.45)"/>
    ${walkImg}${idleImg}
    <text y="${nameY}" text-anchor="middle"
      font-family="'Courier New',Courier,monospace" font-size="7"
      fill="white" stroke="black" stroke-width="2" paint-order="stroke">${def.name}</text>
  </g>`;

  } else {
    // Fallback diamond shape
    const r       = 14;
    const diamond = `0,${-r} ${r*0.7},0 0,${r} ${-r*0.7},0`;
    bodyStr = `
  <g id="pkmn${idx}">
    <animateTransform attributeName="transform" type="translate"
      values="${translates}" keyTimes="${ktStr};1"
      dur="${totalDurSec.toFixed(2)}s" begin="${delaySec.toFixed(2)}s"
      calcMode="linear" repeatCount="indefinite" additive="replace"/>
    <ellipse cx="0" cy="${r*0.9}" rx="8" ry="3" fill="rgba(0,0,0,0.45)"/>
    <polygon points="${diamond}" fill="${def.color}" stroke="${def.secondaryColor ?? '#fff'}" stroke-width="1.5"/>
    <text y="${r + 12}" text-anchor="middle"
      font-family="'Courier New',Courier,monospace" font-size="7"
      fill="white" stroke="black" stroke-width="2" paint-order="stroke">${def.name}</text>
  </g>`;
  }

  return { defs: defsStr, svg: bodyStr };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating PMD dungeon SVG …');

  // Load sprites
  const spriteInfos = POKEMON.map(def => {
    const localPath = (def.animations.walk ?? '').replace(/^\.\//, '');
    if (!localPath || !existsSync(localPath)) {
      console.warn(`  ⚠ Walk sprite not found: ${localPath}`);
      return null;
    }
    const walkUri = `data:image/png;base64,${readFileSync(localPath).toString('base64')}`;
    const { w: sheetW, h: sheetH } = pngSize(localPath);
    const anim = parseAnim(localPath, 'Walk');
    if (!anim) { console.warn(`  ⚠ No Walk AnimData for ${def.name}`); return null; }
    const { frameW, frameH, frameCount, durSec } = anim;
    console.log(`  ✓ ${def.name}: Walk ${frameW}×${frameH} ${frameCount}f ${durSec.toFixed(3)}s`);

    let idleUri = null, idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec;
    const idlePath = (def.animations.idle ?? '').replace(/^\.\//, '');
    if (idlePath && existsSync(idlePath)) {
      const ia = parseAnim(idlePath, 'Idle');
      if (ia) {
        idleUri    = `data:image/png;base64,${readFileSync(idlePath).toString('base64')}`;
        const { w: iW, h: iH } = pngSize(idlePath);
        idleSheetW = iW; idleSheetH = iH;
        idleFrameW = ia.frameW; idleFrameH = ia.frameH;
        idleFrameCount = ia.frameCount; idleDurSec = ia.durSec;
        console.log(`    idle: ${idleFrameW}×${idleFrameH} ${idleFrameCount}f ${idleDurSec.toFixed(3)}s`);
      }
    }
    return { walkUri, idleUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
             idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec };
  });

  // Generate dungeon
  const { grid, rooms, floorCells, W, H } = generateDungeon();
  console.log(`  Dungeon: ${rooms.length} rooms, ${floorCells.length} floor cells`);

  // Paths + timing
  const paths  = POKEMON.map(() => generateRoomPath(rooms, 3 + ri(0, 2)));
  const durs   = POKEMON.map(() => rf(18, 28));
  const delays = POKEMON.map((_, i) => rf(0, 6) + i * 0.9);

  // Build pokemon SVGs
  const pkParts = POKEMON.map((def, i) =>
    buildPokemonSVG(i, def, paths[i], durs[i], delays[i], spriteInfos[i])
  );
  const pkDefs = pkParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pkSVGs = pkParts.map(p => p.svg).join('\n');

  // Tile patterns + dungeon
  const tilePatterns = buildTilePatterns(TS);
  const dungeonSVG   = dungeonToSVG(grid, W, H, TS);
  const waterFX      = waterAnimSVG(grid, W, H, TS);

  // Legend
  const legY = SVG_H - LEG_H + 4;
  const legendItems = POKEMON.map((def, i) => {
    const lx = 10 + i * Math.floor(SVG_W / POKEMON.length);
    return [
      `<circle cx="${lx + 4}" cy="${legY + 4}" r="4" fill="${def.color}"/>`,
      `<text x="${lx + 11}" y="${legY + 8}" font-family="'Courier New',monospace" font-size="7" fill="#ccc">${def.name}</text>`,
    ].join('');
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
<style>
@keyframes shimmer{0%,100%{opacity:.1}50%{opacity:.3}}
.shimmer{animation:shimmer 2.4s ease-in-out infinite}
</style>
<defs>
  <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
    <stop offset="0%"   stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(0,0,10,0.55)"/>
  </radialGradient>
  <linearGradient id="titlebar" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0%"   stop-color="#0a1428"/>
    <stop offset="50%"  stop-color="#12204a"/>
    <stop offset="100%" stop-color="#0a1428"/>
  </linearGradient>
  ${tilePatterns}
  ${pkDefs}
</defs>

<!-- background -->
<rect width="${SVG_W}" height="${SVG_H}" fill="#0D0D1A"/>

<!-- dungeon tilemap -->
<g id="dungeon">${dungeonSVG}</g>

<!-- water shimmer -->
<g id="water-fx" opacity="0.7">${waterFX}</g>

<!-- pokemon -->
<g id="npcs">${pkSVGs}</g>

<!-- vignette overlay -->
<rect width="${SVG_W}" height="${SVG_H}" fill="url(#vignette)"/>

<!-- title bar -->
<rect x="0" y="0" width="${SVG_W}" height="${TITLE_H}" fill="url(#titlebar)" opacity="0.94"/>
<text x="${SVG_W / 2}" y="18" text-anchor="middle"
  font-family="'Courier New',Courier,monospace" font-size="11" font-weight="bold"
  fill="#88ddff" letter-spacing="2">&#9670; POKEMON MYSTERY DUNGEON WORLD &#9670;</text>
<line x1="0" y1="${TITLE_H}" x2="${SVG_W}" y2="${TITLE_H}" stroke="#1a3060" stroke-width="1"/>

<!-- legend -->
<rect x="0" y="${SVG_H - LEG_H}" width="${SVG_W}" height="${LEG_H}" fill="rgba(0,0,0,0.65)"/>
${legendItems}

</svg>
`;

  mkdirSync('assets', { recursive: true });
  const outPath = 'assets/pokemon-world.svg';
  const { writeFileSync } = await import('fs');
  writeFileSync(outPath, svg, 'utf8');
  console.log(`✅  Written ${outPath}  (${(svg.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
