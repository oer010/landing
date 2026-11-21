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
      // 403/429/5xx: FAA struper ved mange spørringer – vent og prøv igjen.
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      const wait = [5, 15, 30, 60][attempt] * 1000;
      console.log(`${designators.slice(0, 3).join(',')}…: ${e.message}, prøver igjen om ${wait / 1000} s`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}

const notams = new Map();
const skipped = [];
const failed = [];
// Grupper på 15 (få spørringer). FAA avviser hele gruppen om én kode er ukjent for dem –
// da tas de ukjente ut og gruppen spørres på nytt.
async function fetchGroup(group) {
  let batch = [...group];
  for (let offset = 0; batch.length; ) {
    const d = await search(batch, offset);
    if (d.error) {
      const bad = [...String(d.error).matchAll(/'([A-Z0-9]{3,4})'/g)].map((m) => m[1]);
      if (!bad.length) throw new Error(d.error);
      skipped.push(...bad);
      batch = batch.filter((b) => !bad.includes(b));
      offset = 0;
      continue;
    }
    const list = d.notamList ?? [];
    for (const n of list) {
      const msg = (n.icaoMessage || '').trim();
      if (!msg) continue;
      const id = msg.match(/^[A-Z]\d{4}\/\d{2}/)?.[0] ?? `${n.facilityDesignator}-${n.notamNumber}`;
      notams.set(id, { loc: n.icaoId || n.facilityDesignator || batch[0], msg });
    }
    const total = d.totalNotamCount ?? 0;
    offset += list.length;
    if (!list.length || offset >= total) break;
    await new Promise((r) => setTimeout(r, 700));
  }
}
for (let i = 0; i < locs.length; i += 15) {
  const group = locs.slice(i, i + 15);
  try {
    await fetchGroup(group);
  } catch (e) {
    console.log(`Feilet for ${group.join(' ')}: ${e.message}`);
    failed.push(...group);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
// Flyplasser som feilet: behold forrige publiserte NOTAM for dem (bedre enn ingenting).
if (failed.length && process.env.PREVIOUS_URL) {
  try {
    const prev = await (await fetch(process.env.PREVIOUS_URL)).json();
    let kept = 0;
    for (const n of prev.notams ?? []) {
      const id = n.msg.match(/^[A-Z]\d{4}\/\d{2}/)?.[0];
      if (id && failed.includes(n.loc) && !notams.has(id)) {
        notams.set(id, n);
        kept++;
      }
    }
    console.log(`Beholdt ${kept} NOTAM fra forrige kjøring for ${failed.length} lokasjoner som feilet`);
  } catch (e) {
    console.log(`Kunne ikke hente forrige fil: ${e.message}`);
  }
}
console.log(`${notams.size} NOTAM fra ${locs.length - skipped.length} lokasjoner. Ukjent hos FAA: ${skipped.join(' ') || '–'}`);

if (!notams.size) {
  console.error('Fant ingen NOTAM – beholder forrige fil');
  process.exit(1);
}
const data = { generated: new Date().toISOString(), source: 'FAA NOTAM Search (notams.aim.faa.gov), ICAO-format', failed, notams: [...notams.values()] };
await writeFile(out, JSON.stringify(data));
console.log(`Skrev ${notams.size} NOTAM til ${out}`);
