// Luftfartshindre i Norge fra OpenStreetMap (Overpass). Master, tårn, piper,
// vindturbiner m.m. ble importert fra Kartverkets NRL (CC BY 4.0) og holdes oppdatert.
// Kjøres av GitHub Actions (.github/workflows/data.yml).
// Bruk: node scripts/obstacles-fetch.mjs <ut.json>

import { writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'obstacles.json';
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Norge delt i mindre bokser (sør, vest, øst, midt, nord), så hver spørring blir lett.
const BOXES = [
  [57.9, 4.0, 60.0, 8.5],
  [57.9, 8.5, 60.0, 12.6],
  [60.0, 4.0, 62.5, 8.5],
  [60.0, 8.5, 62.5, 12.9],
  [62.5, 4.5, 65.0, 14.5],
  [65.0, 10.0, 68.0, 18.5],
  [68.0, 12.0, 71.3, 31.5],
];
const query = (b) => `[out:json][timeout:180][bbox:${b.join(',')}];
(
  node["man_made"~"^(mast|tower|communications_tower|chimney|crane|flagpole)$"]["height"];
  node["power"="generator"]["generator:source"="wind"];
  node["aeroway:light"="obstacle"];
  node["power"="tower"]["height"];
);
out qt;`;

async function run(q) {
  for (let attempt = 0; attempt < 3; attempt++)
    for (const url of SERVERS) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 200000);
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal, headers: { 'user-agent': 'vfr-flyapp-obstacles/1.0 (github.com/oer010/landing)' } });
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d.remark && /runtime error|timed out/i.test(d.remark)) throw new Error(d.remark);
        return d;
      } catch (e) {
        console.log(`${url}: ${e.message}`);
        await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
      }
    }
  throw new Error('Overpass svarte ikke');
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const d = { elements: [] };
for (const b of BOXES) {
  const part = await run(query(b));
  console.log(`${b.join(',')}: ${part.elements?.length ?? 0}`);
  d.elements.push(...(part.elements ?? []));
}
const TYPE = { mast: 'M', communications_tower: 'M', tower: 'T', chimney: 'C', crane: 'K', flagpole: 'M' };
const rows = [];
const seen = new Set();
for (const e of d.elements ?? []) {
  if (seen.has(e.id)) continue;
  seen.add(e.id);
  const t = e.tags ?? {};
  const wind = t['generator:source'] === 'wind';
  const h = num(t.height) ?? (wind ? 150 : null);
  if (h === null || h < 15) continue;
  const ele = num(t.ele);
  const type = wind ? 'W' : t.power === 'tower' ? 'P' : TYPE[t.man_made] ?? 'O';
  // [lat, lon, høyde m, terrenghøyde m eller null, type, lys 1/0]
  rows.push([+e.lat.toFixed(5), +e.lon.toFixed(5), Math.round(h), ele === null ? null : Math.round(ele), type, t['aeroway:light'] ? 1 : 0]);
}
if (rows.length < 1000) {
  console.error(`Bare ${rows.length} hindre – beholder forrige fil`);
  process.exit(1);
}
const withEle = rows.filter((r) => r[3] !== null).length;
await writeFile(out, JSON.stringify({ generated: new Date().toISOString(), source: 'OpenStreetMap (ODbL), hinder importert fra Kartverket NRL (CC BY 4.0)', fields: ['lat', 'lon', 'heightM', 'groundM', 'type', 'lit'], obstacles: rows }));
console.log(`Skrev ${rows.length} hindre (${withEle} med terrenghøyde) til ${out}`);
