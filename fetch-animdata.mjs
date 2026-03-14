// fetch-animdata.mjs – downloads AnimData.xml for all project sprites
import { get } from 'https';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite';
const targets = [
  { path: '0658' },
  { path: '0717' },
  { path: '0719/0001' },
  { path: '0936' },
  { path: '0937' },
  { path: '1006' },
];

function fetchText(url) {
  return new Promise((res, rej) => {
    get(url, r => {
      if (r.statusCode !== 200) return rej(new Error(r.statusCode + ' ' + url));
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => res(Buffer.concat(c).toString()));
    }).on('error', rej);
  });
}

for (const t of targets) {
  const url = `${BASE}/${t.path}/AnimData.xml`;
  try {
    const xml = await fetchText(url);
    const dir = `assets/sprites/${t.path}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/AnimData.xml`, xml);
    const walkM = xml.match(/<Name>Walk<\/Name>[\s\S]*?<FrameWidth>(\d+)<\/FrameWidth>[\s\S]*?<FrameHeight>(\d+)<\/FrameHeight>[\s\S]*?<Durations>([\s\S]*?)<\/Durations>/);
    if (walkM) {
      const fc = (walkM[3].match(/<Duration>/g) || []).length;
      const durs = [...walkM[3].matchAll(/<Duration>(\d+)<\/Duration>/g)].map(m => +m[1]);
      const totalTicks = durs.reduce((a,b)=>a+b,0);
      console.log(`✓ ${t.path}: Walk ${walkM[1]}x${walkM[2]} ${fc} frames ${totalTicks} ticks → ${(totalTicks/60).toFixed(3)}s`);
    }
  } catch(e) {
    console.log(`✗ ${t.path}:`, e.message);
  }
}
