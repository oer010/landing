// Henter gjeldende NOTAM for norske flyplasser og Polaris FIR (ENOR) / Bodø Oceanic (ENOB)
// fra FAAs offentlige NOTAM-søk (internasjonale NOTAM i ICAO-format, uten nøkkel).
// Kjøres av GitHub Actions (.github/workflows/notam.yml) og skriver én JSON-fil.
// Bruk: node scripts/notam-fetch.mjs <ut.json>

import { readFile, writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'notam.json';
const URL_ = 'https://notams.aim.faa.gov/notamSearch/search';

// Flyplasslisten: bygget lokalt (public/data) eller den publiserte kopien (vfr/data).
const db = JSON.parse(
  await readFile(new URL('../public/data/airports.json', import.meta.url), 'utf8').catch(() =>
    readFile(new URL('../../vfr/data/airports.json', import.meta.url), 'utf8'),
  ),
);
const idents = db.airports.map((a) => a[0]).filter((id) => /^EN[A-Z]{2}$/.test(id));
const locs = [...new Set(['ENOR', 'ENOB', ...idents])];

async function search(designators, offset) {
  // Samme felt som FAAs eget søkeskjema sender.
  const body = new URLSearchParams({
    searchType: '0',
    designatorsForLocation: designators.join(','),
    designatorForAccountable: '',
    latDegrees: '',
    latMinutes: '0',
    latSeconds: '0',
    longDegrees: '',
    longMinutes: '0',
    longSeconds: '0',
    radius: '10',
    sortColumns: '5 false',
    sortDirection: 'true',
    designatorForNotamNumberSearch: '',
    notamNumber: '',
    radiusSearchOnDesignator: 'false',
    radiusSearchDesignator: '',
    latitudeDirection: 'N',
    longitudeDirection: 'W',
    freeFormText: '',
    flightPathText: '',
    flightPathDivertAirfields: '',
    flightPathBuffer: '4',
    flightPathIncludeNavaids: 'true',
    flightPathIncludeArtcc: 'false',
    flightPathIncludeTfr: 'true',
    flightPathIncludeRegulatory: 'false',
    flightPathResultsType: 'All NOTAMs',
    archiveDate: '',
    archiveDesignator: '',
    offset: String(offset),
    notamsOnly: 'false',
    filters: '',
    minRunwayLength: '',
    minRunwayWidth: '',
    runwaySurfaceTypes: '',
    predefinedAbraka: '',
    predefinedDabra: '',
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
const skipped = [];
// Én lokasjon per spørring: FAA avviser hele spørringen om én kode er ukjent for dem.
for (const loc of locs) {
  for (let offset = 0; ; ) {
    const d = await search([loc], offset);
    if (d.error) {
      skipped.push(loc);
      break;
    }
    const list = d.notamList ?? [];
    if (list.length && !notams.size) console.log('Eksempel:', JSON.stringify(list[0]).slice(0, 600));
    for (const n of list) {
      const msg = (n.icaoMessage || '').trim();
      if (!msg) continue;
      const id = msg.match(/^[A-Z]\d{4}\/\d{2}/)?.[0] ?? `${n.facilityDesignator}-${n.notamNumber}`;
      notams.set(id, { loc: n.icaoId || n.facilityDesignator || loc, msg });
    }
    const total = d.totalNotamCount ?? 0;
    offset += list.length;
    if (!list.length || offset >= total) break;
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`${notams.size} NOTAM fra ${locs.length - skipped.length} lokasjoner. Ukjent hos FAA: ${skipped.join(' ') || '–'}`);

if (!notams.size) {
  console.error('Fant ingen NOTAM – beholder forrige fil');
  process.exit(1);
}
const data = { generated: new Date().toISOString(), source: 'FAA NOTAM Search (notams.aim.faa.gov), ICAO-format', notams: [...notams.values()] };
await writeFile(out, JSON.stringify(data));
console.log(`Skrev ${notams.size} NOTAM til ${out}`);
