#!/usr/bin/env node
// generate-svg.mjs – Generates assets/pokemon-world.svg
// Run: node generate-svg.mjs
//
// Produces a self-contained animated SVG suitable for GitHub README embedding.
// Pokemon are rendered as glowing diamond shapes (fallback-safe: no external images needed).
// CSS @keyframes provide smooth movement and idle bob animations.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { TileMap } from './src/tilemap.js';
import { TILE, TILE_COLOR, TILE_SIZE, MAP_W, MAP_H, CANVAS_W, CANVAS_H, POKEMON_DEFS } from './src/config.js';

// ─── Sprite helpers ───────────────────────────────────────────────────────────
function pngSize(filePath) {
  const buf = readFileSync(filePath);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Walk up from the sprite PNG's directory to find AnimData.xml, parse Walk dims.
function parseAnimData(walkPngPath) {
  let dir = dirname(walkPngPath);
  for (let i = 0; i < 5; i++) {
    const xmlPath = join(dir, 'AnimData.xml');
    if (existsSync(xmlPath)) {
      const xml = readFileSync(xmlPath, 'utf8');
      const m = xml.match(/<Name>Walk<\/Name>[\s\S]*?<FrameWidth>(\d+)<\/FrameWidth>[\s\S]*?<FrameHeight>(\d+)<\/FrameHeight>[\s\S]*?<Durations>([\s\S]*?)<\/Durations>/);
      if (m) {
        const frameW = +m[1], frameH = +m[2];
        const durs = [...m[3].matchAll(/<Duration>(\d+)<\/Duration>/g)];
        const frameCount = durs.length;
        const totalTicks = durs.reduce((s, d) => s + +d[1], 0);
        return { frameW, frameH, frameCount, durSec: totalTicks / 60 };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Parse Idle AnimData from the same AnimData.xml (different <Name>Idle</Name>)
function parseIdleAnimData(walkPngPath) {
  let dir = dirname(walkPngPath);
  for (let i = 0; i < 5; i++) {
    const xmlPath = join(dir, 'AnimData.xml');
    if (existsSync(xmlPath)) {
      const xml = readFileSync(xmlPath, 'utf8');
      const m = xml.match(/<Name>Idle<\/Name>[\s\S]*?<FrameWidth>(\d+)<\/FrameWidth>[\s\S]*?<FrameHeight>(\d+)<\/FrameHeight>[\s\S]*?<Durations>([\s\S]*?)<\/Durations>/);
      if (m) {
        const frameW = +m[1], frameH = +m[2];
        const durs = [...m[3].matchAll(/<Duration>(\d+)<\/Duration>/g)];
        const frameCount = durs.length;
        const totalTicks = durs.reduce((s, d) => s + +d[1], 0);
        return { frameW, frameH, frameCount, durSec: totalTicks / 60 };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// PMD row order: 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
function getDirectionRow(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const angle = Math.atan2(dy, dx); // -PI..PI, 0=east
  // 8 sectors: 0=E(row2),1=SE(row1)... map to PMD rows
  const sector = Math.round((angle / (Math.PI / 4) + 8)) % 8;
  // sector 0=E→2, 1=SE→1, 2=S→0, 3=SW→7, 4=W→6, 5=NW→5, 6=N→4, 7=NE→3
  return [2, 1, 0, 7, 6, 5, 4, 3][sector];
}

// ─── Config ───────────────────────────────────────────────────────────────────
const SEED     = 42;
const SVG_W    = 960;
const SVG_H    = 480;
const SX       = SVG_W / CANVAS_W;     // x scale (960/1024)
const SY       = SVG_H / CANVAS_H;     // y scale (480/640)
const TS_W     = TILE_SIZE * SX;       // tile width in SVG px
const TS_H     = TILE_SIZE * SY;       // tile height in SVG px

const POKEMON  = Object.values(POKEMON_DEFS);

// ─── Seeded RNG ───────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

const rng     = makeRng(SEED * 31337);
const ri      = (min, max) => Math.floor(rng() * (max - min)) + min;
const rf      = (min, max) => rng() * (max - min) + min;
const fmt1    = n => n.toFixed(1);

// ─── Path generation ──────────────────────────────────────────────────────────
function generatePath(tileMap, n = 14) {
  let tx = ri(4, MAP_W - 4), ty = ri(4, MAP_H - 4);
  for (let a = 0; !tileMap.isWalkable(tx, ty) && a < 200; a++) {
    tx = ri(4, MAP_W - 4); ty = ri(4, MAP_H - 4);
  }

  const pts = [{ x: (tx + 0.5) * TILE_SIZE * SX, y: (ty + 0.5) * TILE_SIZE * SY }];

  for (let i = 1; i < n; i++) {
    let ntx = tx + ri(-7, 8), nty = ty + ri(-5, 6);
    ntx = Math.max(3, Math.min(MAP_W - 4, ntx));
    nty = Math.max(3, Math.min(MAP_H - 4, nty));
    for (let a = 0; !tileMap.isWalkable(ntx, nty) && a < 40; a++) {
      ntx = tx + ri(-7, 8); nty = ty + ri(-5, 6);
      ntx = Math.max(3, Math.min(MAP_W - 4, ntx));
      nty = Math.max(3, Math.min(MAP_H - 4, nty));
    }
    if (tileMap.isWalkable(ntx, nty)) { tx = ntx; ty = nty; }
    pts.push({ x: (tx + 0.5) * TILE_SIZE * SX, y: (ty + 0.5) * TILE_SIZE * SY });
  }
  return pts;
}

// ─── PMD tile pattern defs (SVG <pattern> elements, 24×24 matching tiles.js) ──
function buildTilePatternDefs(tw, th) {
  // NB: tw/th are the SVG display size per tile; patterns tile at full size.
  // We use patternUnits="userSpaceOnUse" so one pattern cell = one tile.
  function pat(id, body) {
    return `<pattern id="${id}" x="0" y="0" width="${tw.toFixed(2)}" height="${th.toFixed(2)}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  }
  const s = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  const TW = tw.toFixed(2), TH = th.toFixed(2);

  // GRASS – PMD bright green with tuft detail
  const grassBody = [
    s(0,0,TW,TH,'#5CB038'),
    s(0,0,TW,'1','#3A7020'), s(0,0,'1',TH,'#3A7020'),
    // lighter stripe pattern
    s('2','2','2','2','#70C848'), s('6','5','2','1','#70C848'),
    s('9','2','1','2','#489028'), s('13','6','2','2','#70C848'),
    s('16','3','1','2','#489028'), s('1','9','2','3','#70C848'),
    s('5','12','1','2','#489028'), s('11','10','2','2','#70C848'),
    s('14','13','1','3','#489028'), s('18','9','2','3','#70C848'),
    s('7','16','2','3','#70C848'), s('15','17','1','3','#489028'),
    s('20','15','2','3','#70C848'),
  ].join('');

  // TALL GRASS – darker denser green
  const tallGrassBody = [
    s(0,0,TW,TH,'#3C8828'),
    s(0,0,TW,'1','#2C6818'), s(0,0,'1',TH,'#2C6818'),
    s('1','1','2','4','#50A038'), s('4','3','1','5','#50A038'),
    s('7','1','2','5','#50A038'), s('10','4','1','4','#2C6818'),
    s('12','1','2','5','#50A038'), s('15','3','1','4','#50A038'),
    s('17','1','2','5','#50A038'), s('20','5','1','3','#2C6818'),
    s('3','10','2','5','#50A038'), s('8','12','1','4','#2C6818'),
    s('13','10','2','5','#50A038'), s('18','12','1','5','#50A038'),
    s('1','17','2','5','#50A038'), s('6','15','1','4','#2C6818'),
    s('11','17','2','5','#50A038'), s('16','16','1','5','#50A038'),
  ].join('');

  // WATER – blue with shimmer lines
  const waterBody = [
    s(0,0,TW,TH,'#2868C0'),
    s(0,0,TW,'1','#1848A0'), s(0,0,'1',TH,'#1848A0'),
    s('0','5',TW,'1','#4890E0'), s('0','13',TW,'1','#4890E0'),
    s('3','3','3','1','#3878D0'), s('9','2','3','1','#3878D0'),
    s('15','3','3','1','#3878D0'), s('4','10','3','1','#3878D0'),
    s('11','11','3','1','#3878D0'), s('17','10','3','1','#3878D0'),
    s('2','17','3','1','#4890E0'), s('8','18','4','1','#4890E0'),
    s('15','17','3','1','#4890E0'),
  ].join('');

  // DEEP WATER – darker
  const deepWaterBody = [
    s(0,0,TW,TH,'#1848A0'),
    s(0,0,TW,'1','#1040A0'), s(0,0,'1',TH,'#1040A0'),
    s('0','5',TW,'1','#2060B8'), s('0','13',TW,'1','#2060B8'),
    s('3','3','3','1','#244898'), s('10','2','4','1','#244898'),
    s('16','4','3','1','#244898'),
  ].join('');

  // PATH – tan stone tiles with grout lines
  const pathBody = [
    s(0,0,TW,TH,'#C8B070'),
    s(0,0,TW,'1','#706040'), s(0,0,'1',TH,'#706040'),
    // grout grid
    s('8','0','1',TH,'#706040'), s('16','0','1',TH,'#706040'),
    s('0','8',TW,'1','#706040'), s('0','16',TW,'1','#706040'),
    // block highlights
    s('1','1','6','6','#D8C090'), s('9','1','6','6','#D8C090'), s('17','1','5','6','#D8C090'),
    s('1','9','6','6','#D8C090'), s('9','9','6','6','#D8C090'), s('17','9','5','6','#D8C090'),
    s('1','17','6','5','#D8C090'), s('9','17','6','5','#D8C090'), s('17','17','5','5','#D8C090'),
    // block shadows
    s('6','1','1','6','#B09848'), s('14','1','1','6','#B09848'),
    s('1','6','7','1','#B09848'), s('1','14','7','1','#B09848'),
  ].join('');

  // SAND – warm beige with granular noise (pre-baked key pixels)
  const sandBody = [
    s(0,0,TW,TH,'#C8A850'),
    s(0,0,TW,'1','#907030'), s(0,0,'1',TH,'#907030'),
    // ripple lines
    s('2','4','3','1','#A88838'), s('8','4','4','1','#A88838'), s('16','4','5','1','#A88838'),
    s('3','11','4','1','#A88838'), s('11','11','3','1','#A88838'), s('17','11','4','1','#A88838'),
    s('1','18','5','1','#A88838'), s('9','18','4','1','#A88838'), s('15','18','5','1','#A88838'),
    // light speckles
    s('4','2','1','1','#E0C068'), s('11','3','1','1','#E0C068'), s('19','6','1','1','#E0C068'),
    s('6','8','1','1','#E0C068'), s('14','9','1','1','#E0C068'), s('2','14','1','1','#E0C068'),
    s('18','15','1','1','#E0C068'), s('7','20','1','1','#E0C068'),
  ].join('');

  // STONE CIRCLE – concentric ring plaza
  const stoneBody = [
    s(0,0,TW,TH,'#787080'),
    s(0,0,TW,'1','#605870'), s(0,0,'1',TH,'#605870'),
    `<circle cx="${(tw/2).toFixed(1)}" cy="${(th/2).toFixed(1)}" r="${(Math.min(tw,th)*0.46).toFixed(1)}" fill="#9890A0"/>`,
    `<circle cx="${(tw/2).toFixed(1)}" cy="${(th/2).toFixed(1)}" r="${(Math.min(tw,th)*0.35).toFixed(1)}" fill="#B0A8B8"/>`,
    `<circle cx="${(tw/2).toFixed(1)}" cy="${(th/2).toFixed(1)}" r="${(Math.min(tw,th)*0.22).toFixed(1)}" fill="#9890A0"/>`,
    `<circle cx="${(tw/2).toFixed(1)}" cy="${(th/2).toFixed(1)}" r="${(Math.min(tw,th)*0.12).toFixed(1)}" fill="#B0A8B8"/>`,
  ].join('');

  // FLOWER (R/Y) – grass base with a small petal
  const flowerRBody = [
    grassBody,
    s('9','8','1','4','#48A038'), // stem
    s('8','7','3','3','#E83030'), s('9','6','1','1','#E83030'), // petals
    s('7','8','1','1','#E83030'), s('11','8','1','1','#E83030'),
    s('9','8','1','1','#FFFFFF'), // centre
  ].join('');
  const flowerYBody = [
    grassBody,
    s('9','8','1','4','#48A038'),
    s('8','7','3','3','#F0D000'), s('9','6','1','1','#F0D000'),
    s('7','8','1','1','#F0D000'), s('11','8','1','1','#F0D000'),
    s('9','8','1','1','#FFFFFF'),
  ].join('');

  return [
    pat('tile-grass',       grassBody),
    pat('tile-tall-grass',  tallGrassBody),
    pat('tile-water',       waterBody),
    pat('tile-deep-water',  deepWaterBody),
    pat('tile-path',        pathBody),
    pat('tile-sand',        sandBody),
    pat('tile-stone',       stoneBody),
    pat('tile-flower-r',    flowerRBody),
    pat('tile-flower-y',    flowerYBody),
  ].join('\n  ');
}

const TILE_PATTERN = {
  [TILE.GRASS]:        'url(#tile-grass)',
  [TILE.TALL_GRASS]:   'url(#tile-tall-grass)',
  [TILE.WATER]:        'url(#tile-water)',
  [TILE.DEEP_WATER]:   'url(#tile-deep-water)',
  [TILE.PATH]:         'url(#tile-path)',
  [TILE.SAND]:         'url(#tile-sand)',
  [TILE.STONE_CIRCLE]: 'url(#tile-stone)',
  [TILE.FLOWER_R]:     'url(#tile-flower-r)',
  [TILE.FLOWER_Y]:     'url(#tile-flower-y)',
  [TILE.TREE]:         'url(#tile-grass)', // trunk base (canopy drawn separately)
};

// ─── Tilemap → SVG rects using patterns ──────────────────────────────────────
function tilemapToSVG(tileMap) {
  // Batch into runs per tile type (not just color) to keep output compact
  const rows = [];
  for (let y = 0; y < MAP_H; y++) {
    let run = null;
    for (let x = 0; x < MAP_W; x++) {
      const tile = tileMap.tiles[y][x];
      const fill = TILE_PATTERN[tile] ?? TILE_COLOR[tile];
      if (run && run.fill === fill) {
        run.w += TS_W;
      } else {
        if (run) rows.push(run);
        run = { fill, x: x * TS_W, y: y * TS_H, w: TS_W, h: TS_H };
      }
    }
    if (run) rows.push(run);
  }
  return rows.map(r =>
    `<rect x="${fmt1(r.x)}" y="${fmt1(r.y)}" width="${fmt1(r.w + 0.5)}" height="${fmt1(r.h + 0.5)}" fill="${r.fill}"/>`
  ).join('\n');
}

// ─── Tree canopies ────────────────────────────────────────────────────────────
function treesToSVG(tileMap) {
  const parts = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tileMap.tiles[y][x] !== TILE.TREE) continue;
      const cx = fmt1((x + 0.5) * TS_W);
      const cy = fmt1((y + 0.38) * TS_H);
      const r  = fmt1(TS_W * 0.5);
      // Outer dark ring
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#287018"/>`);
      // Mid green
      parts.push(`<circle cx="${cx}" cy="${fmt1((y + 0.35) * TS_H)}" r="${fmt1(TS_W * 0.4)}" fill="#388828"/>`);
      // Inner bright
      parts.push(`<circle cx="${fmt1((x + 0.42) * TS_W)}" cy="${fmt1((y + 0.3) * TS_H)}" r="${fmt1(TS_W * 0.26)}" fill="#48A038"/>`);
      // Highlight
      parts.push(`<circle cx="${fmt1((x + 0.36) * TS_W)}" cy="${fmt1((y + 0.24) * TS_H)}" r="${fmt1(TS_W * 0.14)}" fill="#60B848"/>`);
    }
  }
  return parts.join('\n');
}

// ─── CSS for one Pokemon ──────────────────────────────────────────────────────
function pokemonCSS(idx, pts, dur, delay) {
  const movePts = pts.map((p, i) => {
    const pct = Math.round(100 * i / (pts.length - 1));
    return `${pct}%{transform:translate(${fmt1(p.x)}px,${fmt1(p.y)}px)}`;
  }).join('');
  const bobCSS = `@keyframes bob${idx}{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}`;
  return [`@keyframes move${idx}{${movePts}}`, bobCSS].join('\n');
}

// ─── SVG element for one Pokemon ─────────────────────────────────────────────
// Returns { defs, svg }. spriteInfo has walk + idle URIs and anim params.
function pokemonSVG(idx, def, pts, dur, delay, spriteInfo) {
  const start    = pts[0];
  const filterId = `glow${idx}`;
  const clipId   = `spriteclip${idx}`;
  const iClipId  = `idleclip${idx}`;
  const color    = def.color;
  const sec      = def.secondaryColor;
  const n        = pts.length;

  let defsStr = '';
  let bodyStr = '';
  let shadowY, shadowRx, shadowRy, nameY;

  if (spriteInfo) {
    const { walkUri, idleUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
            idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec } = spriteInfo;
    const SC  = 2;
    const dfw = frameW * SC;   // displayed frame width
    const dfh = frameH * SC;   // displayed frame height
    const halfW = dfw / 2;
    const halfH = dfh / 2;

    // Clip paths for walk and idle frames
    defsStr = [
      `<clipPath id="${clipId}"><rect x="${-halfW}" y="${-halfH}" width="${dfw}" height="${dfh}"/></clipPath>`,
      idleUri ? `<clipPath id="${iClipId}"><rect x="${-(idleFrameW*SC/2)}" y="${-(idleFrameH*SC/2)}" width="${idleFrameW*SC}" height="${idleFrameH*SC}"/></clipPath>` : '',
    ].join('');

    // ── Walk x-animation (frame cycling at AnimData speed)
    const xVals = Array.from({length: frameCount}, (_, f) => -halfW - f * dfw).join(';');

    // ── Walk direction y-animation (synced to CSS movement cycle = 2*dur)
    // Forward: pts[0]→pts[n-1]; Backward: pts[n-1]→pts[0] (alternate)
    const yForward  = [];
    const ktForward = [];
    for (let i = 0; i < n - 1; i++) {
      const row = getDirectionRow(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
      yForward.push(-halfH - row * dfh);
      ktForward.push((i / (n - 1)) * 0.5);
    }
    const yBackward  = [];
    const ktBackward = [];
    for (let i = 0; i < n - 1; i++) {
      const row = getDirectionRow(pts[n-2-i].x - pts[n-1-i].x, pts[n-2-i].y - pts[n-1-i].y);
      yBackward.push(-halfH - row * dfh);
      ktBackward.push(0.5 + (i / (n - 1)) * 0.5);
    }
    const yVals  = [...yForward,  ...yBackward,  yForward[0]].join(';');
    const ktVals = [...ktForward, ...ktBackward, 1].map(v => v.toFixed(4)).join(';');

    // Feet are roughly 70% down the frame in PMD sprites
    shadowY  = fmt1(halfH * 0.35);
    shadowRx = fmt1(dfw * 0.36);
    shadowRy = fmt1(dfw * 0.07);
    nameY    = fmt1(halfH * 0.55);

    // ── Walk image element
    const walkImg = `<image id="walk${idx}" href="${walkUri}"
        x="${-halfW}" y="${-halfH}"
        width="${sheetW * SC}" height="${sheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${clipId})">
      <animate attributeName="x" values="${xVals}" dur="${durSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="y" values="${yVals}" keyTimes="${ktVals}" dur="${(dur*2).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>`;

    // ── Idle image element (shown when walk is paused — use display SMIL)
    // We alternate: walk visible for dur s, idle visible for a beat, repeat.
    // Simpler: always show walk (idle switching needs JS; skip for pure SVG)
    bodyStr = walkImg;

    // Optional idle overlay if we have the URI
    if (idleUri) {
      const idfw = idleFrameW * SC;
      const idfh = idleFrameH * SC;
      const ihalfW = idfw / 2;
      const ihalfH = idfh / 2;
      const ixVals = Array.from({length: idleFrameCount}, (_, f) => -ihalfW - f * idfw).join(';');
      // Idle: show at waypoints — approximate by showing idle every other half-cycle
      // Use SMIL display toggling: walk is visible first half, idle second half of each direction cycle
      bodyStr += `
    <image id="idle${idx}" href="${idleUri}"
        x="${-ihalfW}" y="${-ihalfH}"
        width="${idleSheetW * SC}" height="${idleSheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${iClipId})">
      <animate attributeName="x" values="${ixVals}" dur="${idleDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="display" values="none;inline;none" keyTimes="0;0.5;0.75" dur="${(dur*2).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>`;
      // Also hide walk image during idle phase
      bodyStr = `<image id="walk${idx}" href="${walkUri}"
        x="${-halfW}" y="${-halfH}"
        width="${sheetW * SC}" height="${sheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${clipId})">
      <animate attributeName="x" values="${xVals}" dur="${durSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="y" values="${yVals}" keyTimes="${ktVals}" dur="${(dur*2).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="display" values="inline;inline;none" keyTimes="0;0;0.5" dur="${(dur*2).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>
    <image id="idle${idx}" href="${idleUri}"
        x="${-ihalfW}" y="${-ihalfH}"
        width="${idleSheetW * SC}" height="${idleSheetH * SC}"
        image-rendering="pixelated"
        clip-path="url(#${iClipId})">
      <animate attributeName="x" values="${ixVals}" dur="${idleDurSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
      <animate attributeName="display" values="none;inline;none" keyTimes="0;0.5;1" dur="${(dur*2).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>`;
    }

  } else {
    const r       = Math.max(10, def.frameSize * SX * 0.7);
    const diamond = `0,${fmt1(-r)} ${fmt1(r*0.7)},0 0,${fmt1(r)} ${fmt1(-r*0.7)},0`;
    const innerR  = r * 0.45;
    const inner   = `0,${fmt1(-innerR)} ${fmt1(innerR*0.7)},0 0,${fmt1(innerR)} ${fmt1(-innerR*0.7)},0`;
    bodyStr  = `<polygon points="${diamond}" fill="${color}" opacity="0.35" filter="url(#${filterId})"/>
      <polygon points="${diamond}" fill="${color}" stroke="${sec}" stroke-width="1.5"/>
      <polygon points="${inner}"   fill="${sec}" opacity="0.45"/>`;
    shadowY  = fmt1(r * 0.9); shadowRx = '8'; shadowRy = '3'; nameY = fmt1(r + 13);
  }

  const svg = `
  <filter id="${filterId}" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <g style="animation:move${idx} ${dur.toFixed(1)}s ease-in-out ${delay.toFixed(2)}s infinite alternate;transform:translate(${fmt1(start.x)}px,${fmt1(start.y)}px)">
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.45)"/>
    <g style="animation:bob${idx} ${(1.8 + idx * 0.3).toFixed(1)}s ease-in-out ${delay.toFixed(2)}s infinite">
      ${bodyStr}
    </g>
    <text y="${nameY}" text-anchor="middle"
      font-family="'Courier New',Courier,monospace" font-size="7"
      fill="white" stroke="black" stroke-width="2" paint-order="stroke">${def.name}</text>
  </g>`;

  return { defs: defsStr, svg };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating Pokemon World SVG …');

  // Pre-load sprites as base64 data URIs (makes SVG fully self-contained)
  const spriteInfos = POKEMON.map(def => {
    const localPath = def.animations.walk.replace(/^\.\//,  '');
    if (!existsSync(localPath)) {
      console.warn(`  ⚠ Walk sprite not found: ${localPath}`);
      return null;
    }
    const walkUri = `data:image/png;base64,${readFileSync(localPath).toString('base64')}`;
    const { w: sheetW, h: sheetH } = pngSize(localPath);
    const anim = parseAnimData(localPath);
    if (!anim) {
      console.warn(`  ⚠ No AnimData.xml for ${localPath}, skipping sprite`);
      return null;
    }
    const { frameW, frameH, frameCount, durSec } = anim;
    console.log(`  ✓ ${def.name}: ${frameW}x${frameH} ${frameCount}f ${durSec.toFixed(3)}s (sheet ${sheetW}x${sheetH})`);

    // Idle sprite (optional)
    let idleUri = null, idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec;
    const idlePath = def.animations.idle ? def.animations.idle.replace(/^\.\//,  '') : null;
    if (idlePath && existsSync(idlePath)) {
      idleUri = `data:image/png;base64,${readFileSync(idlePath).toString('base64')}`;
      const { w: iW, h: iH } = pngSize(idlePath);
      idleSheetW = iW; idleSheetH = iH;
      const ia = parseIdleAnimData(idlePath);
      if (ia) {
        idleFrameW = ia.frameW; idleFrameH = ia.frameH;
        idleFrameCount = ia.frameCount; idleDurSec = ia.durSec;
        console.log(`    idle: ${idleFrameW}x${idleFrameH} ${idleFrameCount}f ${idleDurSec.toFixed(3)}s`);
      } else {
        idleUri = null; // no AnimData, skip idle
      }
    }

    return { walkUri, idleUri, sheetW, sheetH, frameW, frameH, frameCount, durSec,
             idleSheetW, idleSheetH, idleFrameW, idleFrameH, idleFrameCount, idleDurSec };
  });

  const tileMap = new TileMap(SEED);

  // Pre-generate paths (seeded so same every run)
  const paths    = POKEMON.map(() => generatePath(tileMap, 14));
  const durs     = POKEMON.map(() => rf(16, 26));
  const delays   = POKEMON.map((_, i) => rf(0, 8) + i * 0.7);

  // ── CSS ──────────────────────────────────────────────────────────────────
  const pokemonCSStyles = POKEMON.map((def, i) =>
    pokemonCSS(i, paths[i], durs[i], delays[i])
  ).join('\n');

  // Water ripple animation
  const waterCSS = `
@keyframes ripple{0%,100%{opacity:.12}50%{opacity:.22}}
.ripple{animation:ripple 2.5s ease-in-out infinite}`;

  const css = `<style>
${pokemonCSStyles}
${waterCSS}
</style>`;

  // ── Tilemap SVG ──────────────────────────────────────────────────────────
  const tilemapSVG = tilemapToSVG(tileMap);
  const treesSVG   = treesToSVG(tileMap);

  // ── Water ripple overlay stripes ─────────────────────────────────────────
  const waterRipples = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tileMap.tiles[y][x] === TILE.WATER || tileMap.tiles[y][x] === TILE.DEEP_WATER) {
        const cx = fmt1((x + 0.5) * TS_W);
        const cy = fmt1((y + 0.45) * TS_H);
        const delay = ((x * 3 + y * 7) % 17) * 0.15;
        waterRipples.push(
          `<line x1="${fmt1((x + 0.2) * TS_W)}" y1="${cy}" x2="${fmt1((x + 0.8) * TS_W)}" y2="${cy}" stroke="white" stroke-width="0.7" class="ripple" style="animation-delay:${delay.toFixed(2)}s"/>`
        );
      }
    }
  }

  // ── Pokemon SVG elements ─────────────────────────────────────────────────
  const pokemonParts = POKEMON.map((def, i) =>
    pokemonSVG(i, def, paths[i], durs[i], delays[i], spriteInfos[i])
  );
  const pokemonDefs = pokemonParts.map(p => p.defs).filter(Boolean).join('\n  ');
  const pokemonSVGs = pokemonParts.map(p => p.svg).join('\n');

  // ── Gradient defs + tile patterns ───────────────────────────────────────
  const defs = `
<defs>
  <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
    <stop offset="0%" stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(0,0,10,0.5)"/>
  </radialGradient>
  <linearGradient id="titlebar" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0%"   stop-color="#0a1428"/>
    <stop offset="50%"  stop-color="#12204a"/>
    <stop offset="100%" stop-color="#0a1428"/>
  </linearGradient>
  ${buildTilePatternDefs(TS_W, TS_H)}
  ${pokemonDefs}
</defs>`;

  // ── Title bar ─────────────────────────────────────────────────────────────
  const titlebar = `
<rect x="0" y="0" width="${SVG_W}" height="28" fill="url(#titlebar)" opacity="0.92"/>
<text x="${SVG_W / 2}" y="18" text-anchor="middle"
  font-family="'Courier New',Courier,monospace" font-size="11" font-weight="bold"
  fill="#88ddff" letter-spacing="2">◆ POKEMON MYSTERY DUNGEON WORLD ◆</text>
<line x1="0" y1="28" x2="${SVG_W}" y2="28" stroke="#1a3060" stroke-width="1"/>`;

  // ── Legend strip at bottom ────────────────────────────────────────────────
  const legendY  = SVG_H - 20;
  const legendCSS = POKEMON.map((def, i) => {
    const lx = 12 + i * (SVG_W / POKEMON.length);
    return [
      `<circle cx="${fmt1(lx)}" cy="${legendY + 4}" r="4" fill="${def.color}"/>`,
      `<text x="${fmt1(lx + 8)}" y="${legendY + 8}" font-family="'Courier New',monospace" font-size="7" fill="#aaa">${def.name}</text>`,
    ].join('');
  }).join('');

  const legend = `
<rect x="0" y="${legendY - 6}" width="${SVG_W}" height="26" fill="rgba(0,0,0,0.6)"/>
${legendCSS}`;

  // ── Full SVG ──────────────────────────────────────────────────────────────
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
${css}
${defs}

<!-- ── Background colour ── -->
<rect width="${SVG_W}" height="${SVG_H}" fill="#0a1218"/>

<!-- ── Tilemap ── -->
<g id="tilemap">
${tilemapSVG}
</g>

<!-- ── Water ripples ── -->
<g id="water-fx" opacity="0.6">
${waterRipples.join('\n')}
</g>

<!-- ── Tree canopies ── -->
<g id="trees">
${treesSVG}
</g>

<!-- ── Pokemon NPCs ── -->
<g id="npcs">
${pokemonSVGs}
</g>

<!-- ── Vignette ── -->
<rect width="${SVG_W}" height="${SVG_H}" fill="url(#vignette)"/>

<!-- ── HUD ── -->
${titlebar}
${legend}

</svg>
`;

  mkdirSync('assets', { recursive: true });
  const outPath = 'assets/pokemon-world.svg';
  writeFileSync(outPath, svg, 'utf-8');
  const kb = (svg.length / 1024).toFixed(1);
  console.log(`✓ Written ${outPath}  (${kb} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
