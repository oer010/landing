// Luftfartshindre i Norge fra OpenStreetMap (Overpass). Master, tårn, piper,
// vindturbiner m.m. ble importert fra Kartverkets NRL (CC BY 4.0) og holdes oppdatert.
// Kjøres av GitHub Actions (.github/workflows/data.yml).
// Bruk: node scripts/obstacles-fetch.mjs <ut.json>

import { writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'obstacles.json';
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const Q = `[out:json][timeout:300];
area["ISO3166-1"="NO"][admin_level=2]->.no;
(
  node(area.no)["man_made"~"^(mast|tower|communications_tower|chimney|crane|flagpole)$"]["height"];
  node(area.no)["power"="generator"]["generator:source"="wind"];
  node(area.no)["aeroway:light"="obstacle"];
  node(area.no)["power"="tower"]["height"];
);
out qt;`;

async function query() {
  for (const url of SERVERS)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: Q }), headers: { 'user-agent': 'vfr-flyapp-obstacles/1.0 (github.com/oer010/landing)' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        console.log(`${url}: ${e.message}`);
        await new Promise((res) => setTimeout(res, 10000 * (attempt + 1)));
      }
    }
  throw new Error('Overpass svarte ikke');
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const d = await query();
const TYPE = { mast: 'M', communications_tower: 'M', tower: 'T', chimney: 'C', crane: 'K', flagpole: 'M' };
const rows = [];
for (const e of d.elements ?? []) {
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
