#!/usr/bin/env node
// Laster ned åpne flyplass- og navaid-data fra OurAirports (public domain)
// og lager en kompakt JSON-fil som appen bruker offline.
//
// Miljøvariabler:
//   FLYAPP_COUNTRIES  Kommaseparerte ISO-landkoder (f.eks. "NO,SE,DK,FI").
//                     Tom/ikke satt = hele Europa. "ALL" = hele verden.
//   FLYAPP_DATA_URL   Alternativ base-URL for CSV-filene (speil/cache).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.FLYAPP_DATA_URL || 'https://davidmegginson.github.io/ourairports-data').replace(/\/$/, '');
const COUNTRIES = (process.env.FLYAPP_COUNTRIES || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'airports.json');

const AIRPORT_TYPES = { large_airport: 'L', medium_airport: 'M', small_airport: 'S', seaplane_base: 'W' };
const NAVAID_TYPES = new Set(['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME', 'DME', 'TACAN']);

/** Minimal RFC 4180-parser (håndterer anførselstegn, komma og linjeskift i felt). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchCsv(name) {
  const url = `${BASE}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  console.log(`Hentet ${name}: ${rows.length} rader`);
  return rows;
}

const num = (s, d = 0) => {
  if (s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? Number(v.toFixed(d)) : null;
};

function inRegion(country, continent) {
  if (COUNTRIES.includes('ALL')) return true;
  if (COUNTRIES.length) return COUNTRIES.includes(country);
  return continent === 'EU';
}

async function main() {
  const [airports, runways, freqs, navaids] = await Promise.all([
    fetchCsv('airports.csv'),
    fetchCsv('runways.csv'),
    fetchCsv('airport-frequencies.csv'),
    fetchCsv('navaids.csv'),
  ]);

  const rwyByAirport = new Map();
  for (const r of runways) {
    if (r.closed === '1') continue;
    const list = rwyByAirport.get(r.airport_ident) ?? [];
    // [leIdent, heIdent, lengthFt, widthFt, surface, lighted, leLat, leLon, heLat, heLon, leHdgT]
    list.push([
      r.le_ident,
      r.he_ident,
      num(r.length_ft),
      num(r.width_ft),
      r.surface,
      r.lighted === '1' ? 1 : 0,
      num(r.le_latitude_deg, 5),
      num(r.le_longitude_deg, 5),
      num(r.he_latitude_deg, 5),
      num(r.he_longitude_deg, 5),
      num(r.le_heading_degT, 0),
    ]);
    rwyByAirport.set(r.airport_ident, list);
  }

  const freqByAirport = new Map();
  for (const f of freqs) {
    const list = freqByAirport.get(f.airport_ident) ?? [];
    list.push([f.type, f.description, num(f.frequency_mhz, 3)]);
    freqByAirport.set(f.airport_ident, list);
  }

  const outAirports = [];
  for (const a of airports) {
    const t = AIRPORT_TYPES[a.type];
    if (!t || !inRegion(a.iso_country, a.continent)) continue;
    // [ident, name, type, lat, lon, elevFt, country, municipality, iata, runways, freqs]
    outAirports.push([
      a.ident,
      a.name,
      t,
      num(a.latitude_deg, 5),
      num(a.longitude_deg, 5),
      num(a.elevation_ft),
      a.iso_country,
      a.municipality,
      a.iata_code,
      rwyByAirport.get(a.ident) ?? [],
      freqByAirport.get(a.ident) ?? [],
    ]);
  }

  const countrySet = new Set(outAirports.map((a) => a[6]));
  const outNavaids = navaids
    .filter((n) => NAVAID_TYPES.has(n.type) && countrySet.has(n.iso_country))
    // [ident, name, type, freqKhz, lat, lon, elevFt, country]
    .map((n) => [
      n.ident,
      n.name,
      n.type,
      num(n.frequency_khz),
      num(n.latitude_deg, 5),
      num(n.longitude_deg, 5),
      num(n.elevation_ft),
      n.iso_country,
    ]);

  const payload = {
    generated: new Date().toISOString(),
    source: 'OurAirports (https://ourairports.com/data/) – public domain',
    region: COUNTRIES.length ? COUNTRIES.join(',') : 'EU',
    airports: outAirports,
    navaids: outNavaids,
  };
  await mkdir(dirname(OUT), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(OUT, json);
  console.log(
    `Skrev ${outAirports.length} flyplasser og ${outNavaids.length} navaids (${(json.length / 1e6).toFixed(1)} MB) til ${OUT}`,
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (isMain && proxy && !process.env.NODE_USE_ENV_PROXY) {
  // Nodes innebygde fetch bruker bare HTTPS_PROXY når NODE_USE_ENV_PROXY=1
  // er satt ved oppstart (Node >= 22.21). Start skriptet på nytt med den.
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
} else if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
