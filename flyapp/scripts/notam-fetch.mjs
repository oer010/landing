// Henter gjeldende NOTAM for norske flyplasser og Polaris FIR (ENOR) / Bodø Oceanic (ENOB)
// fra FAAs offentlige NOTAM-søk (internasjonale NOTAM i ICAO-format, uten nøkkel).
// Kjøres av GitHub Actions (.github/workflows/notam.yml) og skriver én JSON-fil.
// Bruk: node scripts/notam-fetch.mjs <ut.json>

import { readFile, writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'notam.json';
const URL_ = 'https://notams.aim.faa.gov/notamSearch/search';

const db = JSON.parse(await readFile(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const idents = db.airports.map((a) => a[0]).filter((id) => /^EN[A-Z]{2}$/.test(id));
const locs = [...new Set(['ENOR', 'ENOB', ...idents])];

async function search(designators, offset) {
  const body = new URLSearchParams({
    searchType: '0',
    designatorsForLocation: designators.join(','),
    offset: String(offset),
    notamsOnly: 'false',
    radius: '10',
    sortColumns: '5 false',
    sortDirection: 'true',
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(URL_, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'vfr-flyapp-notam/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

const notams = new Map();
for (let i = 0; i < locs.length; i += 15) {
  const batch = locs.slice(i, i + 15);
  for (let offset = 0; ; ) {
    const d = await search(batch, offset);
    const list = d.notamList ?? [];
    for (const n of list) {
      const msg = (n.icaoMessage || '').trim();
      if (!msg) continue;
      const id = msg.match(/^[A-Z]\d{4}\/\d{2}/)?.[0] ?? `${n.facilityDesignator}-${n.notamNumber}`;
      notams.set(id, { loc: n.icaoId || n.facilityDesignator, msg });
    }
    const total = d.totalNotamCount ?? 0;
    offset += list.length;
    if (!list.length || offset >= total) break;
  }
  console.log(`${batch[0]}…: ${notams.size} totalt`);
}

if (!notams.size) {
  console.error('Fant ingen NOTAM – beholder forrige fil');
  process.exit(1);
}
const data = { generated: new Date().toISOString(), source: 'FAA NOTAM Search (notams.aim.faa.gov), ICAO-format', notams: [...notams.values()] };
await writeFile(out, JSON.stringify(data));
console.log(`Skrev ${notams.size} NOTAM til ${out}`);
