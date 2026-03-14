#!/usr/bin/env node
// generate-svg.mjs – Generates assets/pokemon-world.svg
// Run: node generate-svg.mjs
//
// Produces a self-contained animated SVG suitable for GitHub README embedding.
// Pokemon are rendered as glowing diamond shapes (fallback-safe: no external images needed).
// CSS @keyframes provide smooth movement and idle bob animations.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { TileMap } from './src/tilemap.js';
import { TILE, TILE_COLOR, TILE_SIZE, MAP_W, MAP_H, CANVAS_W, CANVAS_H, POKEMON_DEFS } from './src/config.js';

// ─── Sprite helpers ───────────────────────────────────────────────────────────
function pngSize(filePath) {
  const buf = readFileSync(filePath);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function toDataUri(localUrl) {
  // localUrl is like ./assets/sprites/0658/0000/0001/Walk-Anim.png
  const path = localUrl.replace(/^\.\//, '');
  if (!existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}
// Pick the frame width (fw) and frame count (fc) from the sprite sheet width.
// Tries standard frame counts; picks the one whose fw is closest to hintFw.
function detectFrameLayout(sheetW, hintFw) {
  const candidates = [3, 4, 6, 8, 10, 12, 16];
  let best = null;
  for (const fc of candidates) {
    if (sheetW % fc !== 0) continue;
    const fw = sheetW / fc;
    if (fw < 16) continue;
    const dist = Math.abs(fw - hintFw);
    if (!best || dist < best.dist) best = { fw, fc, dist };
  }
  if (best) return { fw: best.fw, fc: best.fc };
  const fc = Math.max(1, Math.floor(sheetW / hintFw));
  return { fw: hintFw, fc };
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
    const { uri, sheetW, sheetH, actualFrameW, frameCount } = spriteInfo;
    const fw  = actualFrameW;   // native px per frame
    const fw2 = fw * 2;         // displayed px per frame (2x upscale)

    // Clip path: one displayed frame, centred at group origin
    defsStr = `<clipPath id="${clipId}"><rect x="${-fw}" y="${-fw}" width="${fw2}" height="${fw2}"/></clipPath>`;

    // Full sheet rendered at 2x; frame-0 / row-0 (south-facing) centred by positioning at (-fw,-fw)
    bodyStr = `<image href="${uri}"
        x="${-fw}" y="${-fw}"
        width="${sheetW * 2}" height="${sheetH * 2}"
        clip-path="url(#${clipId})"
        style="animation:sf${idx} 0.8s steps(${frameCount},end) ${delay.toFixed(2)}s infinite"/>`;

    shadowY  = fmt1(fw * 1.1);
    shadowRx = fmt1(fw * 0.55);
    shadowRy = fmt1(fw * 0.12);
    nameY    = fmt1(fw * 1.35);
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
    <ellipse cx="0" cy="${shadowY}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.35)"
      style="animation:shadow${idx} ${(dur * 0.12).toFixed(1)}s ease-in-out infinite alternate"/>
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
    const { fw: actualFrameW, fc: frameCount } = detectFrameLayout(sheetW, def.frameSize);
    console.log(`  ✓ ${def.name}: ${sheetW}x${sheetH} -> ${frameCount} frames x ${actualFrameW}px`);
    return { uri, sheetW, sheetH, actualFrameW, frameCount };
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

  // Sprite-frame CSS: total travel = frameCount * actualFrameW * 2 (displayed at 2x scale)
  const spriteFrameCSS = POKEMON.map((def, i) => {
    if (!spriteInfos[i]) return `@keyframes sf${i}{}`;
    const { actualFrameW, frameCount } = spriteInfos[i];
    const totalPx = actualFrameW * frameCount * 2;
    return `@keyframes sf${i}{from{transform:translateX(0)}to{transform:translateX(-${totalPx}px)}}`;
  }).join('\n');

  // Water ripple animation
  const waterCSS = `
@keyframes ripple{0%,100%{opacity:.12}50%{opacity:.22}}
.ripple{animation:ripple 2.5s ease-in-out infinite}`;

  const css = `<style>
${pokemonCSStyles}
${spriteFrameCSS}
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
