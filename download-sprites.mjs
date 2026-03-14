#!/usr/bin/env node
// download-sprites.mjs
// Downloads SpriteCollab sprites for ALL Pokemon (or a subset) from PMDCollab.
//
// Usage:
//   node download-sprites.mjs              # download all canon Pokemon
//   node download-sprites.mjs --id 0658    # single Pokemon by ID
//   node download-sprites.mjs --our        # only the 6 project Pokemon
//   node download-sprites.mjs --limit 151  # first N Pokemon (by Pokedex)
//
// Output: assets/sprites/{id}/[form/][Shiny/]{Animation}-Anim.png
//         assets/sprites/{id}/portrait.png

import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { get }  from 'https';
import { argv } from 'process';

const BASE_SPRITE   = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite';
const BASE_PORTRAIT = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait';
const TRACKER_URL   = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/tracker.json';

const ANIMATIONS = ['Walk', 'Idle', 'Sleep', 'Attack', 'Hurt', 'Shoot', 'Swing', 'Charge'];
const CONCURRENCY = 8;  // parallel downloads

// ─── CLI flags ────────────────────────────────────────────────────────────────
const OUR_POKEMON = ['0719', '0658', '0937', '1006', '0936', '0717'];
const flagOur     = argv.includes('--our');
const flagId      = argv.includes('--id') ? argv[argv.indexOf('--id') + 1] : null;
const flagLimit   = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]) : null;

// ─── HTTP fetch ───────────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((res, rej) => {
    get(url, r => {
      if (r.statusCode !== 200) return rej(new Error(`${r.statusCode} ${url}`));
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', rej);
  });
}

function downloadFile(url, dest) {
  return new Promise((res) => {
    if (existsSync(dest)) { res(true); return; }
    mkdirSync(dirname(dest), { recursive: true });
    const f = createWriteStream(dest);
    get(url, r => {
      if (r.statusCode !== 200) {
        f.close();
        try { require('fs').unlinkSync(dest); } catch {}
        return res(false);
      }
      r.pipe(f);
      f.on('finish', () => { f.close(); res(true); });
    }).on('error', () => { f.close(); res(false); });
  });
}

// ─── Task runner ──────────────────────────────────────────────────────────────
async function runPool(tasks, concurrency) {
  let i = 0;
  let done = 0;
  let ok = 0;
  const total = tasks.length;

  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      const result = await task();
      done++;
      if (result) ok++;
      if (done % 50 === 0) process.stdout.write(`\r  ${done}/${total} (${ok} downloaded) …`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write(`\r  ${done}/${total} (${ok} downloaded) ✓\n`);
}

// ─── Build download list from tracker entry ───────────────────────────────────
function buildTasks(id, entry) {
  const tasks = [];

  // Determine all variants from the entry structure
  // Tracker structure: { "sprite_files": { "forms": { "0000": { "shiny": 1, "gender": 0 } } } }
  const spriteFiles = entry.sprite_files ?? {};
  const forms = spriteFiles.forms ?? { '0000': { shiny: 0 } };

  for (const [formId, formData] of Object.entries(forms)) {
    const variants = [{ shiny: false }];
    if (formData?.shiny) variants.push({ shiny: true });

    for (const { shiny } of variants) {
      const formPath   = formId !== '0000' ? `/${formId}` : '';
      const shinyPath  = shiny ? '/Shiny' : '';
      const destBase   = `assets/sprites/${id}${formPath}${shinyPath}`;

      for (const anim of ANIMATIONS) {
        const url  = `${BASE_SPRITE}/${id}${formPath}${shinyPath}/${anim}-Anim.png`;
        const dest = `${destBase}/${anim}-Anim.png`;
        tasks.push(() => downloadFile(url, dest));
      }
    }
  }

  // Portrait
  const portraitUrl  = `${BASE_PORTRAIT}/${id}/Normal.png`;
  const portraitDest = `assets/sprites/${id}/portrait.png`;
  tasks.push(() => downloadFile(portraitUrl, portraitDest));

  return tasks;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching SpriteCollab tracker …');
  const tracker = JSON.parse(await fetchText(TRACKER_URL));
  console.log(`Tracker loaded: ${Object.keys(tracker).length} entries`);

  let ids = Object.keys(tracker).filter(id => /^\d{4}$/.test(id));

  if (flagId)    ids = [flagId];
  else if (flagOur)   ids = OUR_POKEMON;
  else if (flagLimit) ids = ids.slice(0, flagLimit);

  // Only canon entries with sprites
  if (!flagId && !flagOur) {
    ids = ids.filter(id => tracker[id]?.canon && tracker[id]?.sprite_complete > 0);
  }

  console.log(`Downloading sprites for ${ids.length} Pokemon …`);

  const allTasks = [];
  for (const id of ids) {
    const entry = tracker[id];
    if (!entry) continue;
    allTasks.push(...buildTasks(id, entry));
  }

  console.log(`  ${allTasks.length} files queued (skipping already-downloaded)`);
  await runPool(allTasks, CONCURRENCY);
  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
