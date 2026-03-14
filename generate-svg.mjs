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

// ─── Tilemap → SVG rects ─────────────────────────────────────────────────────
function tilemapToSVG(tileMap) {
  const parts = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const tile  = tileMap.tiles[y][x];
      const color = TILE_COLOR[tile];
      const px    = fmt1(x * TS_W);
      const py    = fmt1(y * TS_H);
      const pw    = fmt1(TS_W + 0.5);   // +0.5 closes sub-pixel gaps
      const ph    = fmt1(TS_H + 0.5);
      parts.push(`<rect x="${px}" y="${py}" w="${pw}" h="${ph}" fill="${color}"/>`);
    }
  }
  // Compact: batch rects by colour to shrink file size
  const rows = [];
  for (let y = 0; y < MAP_H; y++) {
    let run = null;
    for (let x = 0; x < MAP_W; x++) {
      const tile  = tileMap.tiles[y][x];
      const color = TILE_COLOR[tile];
      if (run && run.color === color) {
        run.w += TS_W;
      } else {
        if (run) rows.push(run);
        run = { color, x: x * TS_W, y: y * TS_H, w: TS_W, h: TS_H };
      }
    }
    if (run) rows.push(run);
  }
  return rows.map(r =>
    `<rect x="${fmt1(r.x)}" y="${fmt1(r.y)}" width="${fmt1(r.w)}" height="${fmt1(r.h)}" fill="${r.color}"/>`
  ).join('\n');
}

// ─── Tree canopies as circles ────────────────────────────────────────────────
function treesToSVG(tileMap) {
  const parts = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tileMap.tiles[y][x] !== TILE.TREE) continue;
      const cx = fmt1((x + 0.5) * TS_W);
      const cy = fmt1((y + 0.4) * TS_H);
      const r  = fmt1(TS_W * 0.42);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#2d8b2d" opacity="0.9"/>`);
      parts.push(`<circle cx="${fmt1((x + 0.35) * TS_W)}" cy="${fmt1((y + 0.28) * TS_H)}" r="${fmt1(r * 0.35)}" fill="#55c455" opacity="0.7"/>`);
    }
  }
  return parts.join('\n');
}

// ─── CSS for one Pokemon ──────────────────────────────────────────────────────
function pokemonCSS(idx, pts, dur, delay) {
  // Movement keyframes
  const movePts = pts.map((p, i) => {
    const pct = Math.round(100 * i / (pts.length - 1));
    return `${pct}%{transform:translate(${fmt1(p.x)}px,${fmt1(p.y)}px)}`;
  }).join('');

  // Bob keyframes (idle vertical oscillation)
  const bobName = `bob${idx}`;
  const bobCSS  = `@keyframes ${bobName}{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}`;

  // Shadow scale pulse
  const shadowName = `shadow${idx}`;
  const shadowCSS  = `@keyframes ${shadowName}{0%,100%{rx:8;ry:3}50%{rx:10;ry:4}}`;

  return [
    `@keyframes move${idx}{${movePts}}`,
    bobCSS,
    shadowCSS,
  ].join('\n');
}

// ─── SVG element for one Pokemon ─────────────────────────────────────────────
// Returns { defs, svg } so clip paths live in the outer <defs> block.
function pokemonSVG(idx, def, pts, dur, delay, spriteInfo) {
  const start    = pts[0];
  const filterId = `glow${idx}`;
  const clipId   = `spriteclip${idx}`;
  const color    = def.color;
  const sec      = def.secondaryColor;

  let defsStr = '';
  let bodyStr = '';
  let shadowY, shadowRx, shadowRy, nameY;

  if (spriteInfo) {
    const { uri, sheetW, sheetH, frameW, frameH, frameCount, durSec } = spriteInfo;
    const SCALE = 2;
    const dfw = frameW * SCALE;   // displayed frame width
    const dfh = frameH * SCALE;   // displayed frame height
    const halfW = dfw / 2;
    const halfH = dfh / 2;

    // Clip path: exact frame window centred at group origin
    defsStr = `<clipPath id="${clipId}"><rect x="${-halfW}" y="${-halfH}" width="${dfw}" height="${dfh}"/></clipPath>`;

    // SMIL x values: shift image left by one displayed frame per step.
    // Frame n is visible when image x = -halfW - n*dfw
    const xVals = Array.from({length: frameCount}, (_, n) => -halfW - n * dfw).join(';');

    bodyStr = `<image href="${uri}"
        x="${-halfW}" y="${-halfH}"
        width="${sheetW * SCALE}" height="${sheetH * SCALE}"
        image-rendering="pixelated"
        clip-path="url(#${clipId})">
      <animate attributeName="x" values="${xVals}" dur="${durSec.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>
    </image>`;

    shadowY  = fmt1(halfH + 2);
    shadowRx = fmt1(dfw * 0.38);
    shadowRy = fmt1(dfw * 0.07);
    nameY    = fmt1(halfH + 11);
  } else {
    // Fallback: glowing diamond when sprite is unavailable
    const r       = Math.max(10, def.frameSize * SX * 0.7);
    const diamond = `0,${fmt1(-r)} ${fmt1(r*0.7)},0 0,${fmt1(r)} ${fmt1(-r*0.7)},0`;
    const innerR  = r * 0.45;
    const inner   = `0,${fmt1(-innerR)} ${fmt1(innerR*0.7)},0 0,${fmt1(innerR)} ${fmt1(-innerR*0.7)},0`;
    bodyStr  = `<polygon points="${diamond}" fill="${color}" opacity="0.35" filter="url(#${filterId})"/>
      <polygon points="${diamond}" fill="${color}" stroke="${sec}" stroke-width="1.5"/>
      <polygon points="${inner}"   fill="${sec}" opacity="0.45"/>
      <circle cx="0" cy="${fmt1(-r * 0.2)}" r="2" fill="rgba(255,255,255,0.8)"/>`;
    shadowY  = fmt1(r * 0.9);
    shadowRx = '8';
    shadowRy = '3';
    nameY    = fmt1(r + 13);
  }

  const svg = `
  <!-- ── ${def.name} ── -->
  <filter id="${filterId}" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <g style="animation:move${idx} ${dur.toFixed(1)}s ease-in-out ${delay.toFixed(2)}s infinite alternate;transform:translate(${fmt1(start.x)}px,${fmt1(start.y)}px)">
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.4)"/>
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
      console.warn(`  ⚠ Sprite not found: ${localPath}`);
      return null;
    }
    const uri = `data:image/png;base64,${readFileSync(localPath).toString('base64')}`;
    const { w: sheetW, h: sheetH } = pngSize(localPath);
    const anim = parseAnimData(localPath);
    if (!anim) {
      console.warn(`  ⚠ No AnimData.xml for ${localPath}, skipping sprite`);
      return null;
    }
    const { frameW, frameH, frameCount, durSec } = anim;
    console.log(`  ✓ ${def.name}: ${frameW}x${frameH} ${frameCount}f ${(durSec).toFixed(3)}s (sheet ${sheetW}x${sheetH})`);
    return { uri, sheetW, sheetH, frameW, frameH, frameCount, durSec };
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

  // ── Gradient defs ────────────────────────────────────────────────────────
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
