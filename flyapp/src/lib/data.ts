import { distanceNm, type LatLon } from './geo';

export interface Runway {
  le: string;
  he: string;
  lengthFt: number | null;
  widthFt: number | null;
  surface: string;
  lighted: boolean;
  leEnd: LatLon | null;
  heEnd: LatLon | null;
  leHeadingTrue: number | null;
}

export interface Frequency {
  type: string;
  desc: string;
  mhz: number | null;
}

export interface Airport extends LatLon {
  ident: string;
  name: string;
  /** L = stor, M = middels, S = liten, W = sjøflyhavn */
  type: 'L' | 'M' | 'S' | 'W';
  elevFt: number | null;
  country: string;
  city: string;
  iata: string;
  runways: Runway[];
  freqs: Frequency[];
  towered: boolean;
  paved: boolean;
  longestFt: number;
}

export interface Navaid extends LatLon {
  ident: string;
  name: string;
  type: string;
  freqKhz: number | null;
  elevFt: number | null;
}

type RawRunway = [string, string, number | null, number | null, string, 0 | 1, number | null, number | null, number | null, number | null, number | null];
type RawAirport = [string, string, Airport['type'], number, number, number | null, string, string, string, RawRunway[], [string, string, number | null][]];
type RawNavaid = [string, string, string, number | null, number, number, number | null, string];

const PAVED = /^(ASP|CON|BIT|PEM|TAR|PAV|ASPH|CONC|MAC|BITUM)/i;
const TOWER_TYPES = new Set(['TWR', 'TOWER', 'GND', 'APP']);

export interface AeroDb {
  airports: Airport[];
  navaids: Navaid[];
  byIdent: Map<string, Airport>;
  navaidsByIdent: Map<string, Navaid[]>;
  generated: string;
  region: string;
}

let dbPromise: Promise<AeroDb> | null = null;

export function loadDb(): Promise<AeroDb> {
  dbPromise ??= fetch('./data/airports.json')
    .then((r) => {
      if (!r.ok) throw new Error('Fant ikke flyplassdata. Kjør «npm run data».');
      return r.json();
    })
    .then(buildDb);
  return dbPromise;
}

export function buildDb(raw: { airports: RawAirport[]; navaids: RawNavaid[]; generated: string; region: string }): AeroDb {
  const airports = raw.airports.map((a): Airport => {
    const runways = a[9].map(
      (r): Runway => ({
        le: r[0],
        he: r[1],
        lengthFt: r[2],
        widthFt: r[3],
        surface: r[4],
        lighted: r[5] === 1,
        leEnd: r[6] !== null && r[7] !== null ? { lat: r[6], lon: r[7] } : null,
        heEnd: r[8] !== null && r[9] !== null ? { lat: r[8], lon: r[9] } : null,
        leHeadingTrue: r[10],
      }),
    );
    const freqs = a[10].map((f): Frequency => ({ type: f[0], desc: f[1], mhz: f[2] }));
    return {
      ident: a[0],
      name: a[1],
      type: a[2],
      lat: a[3],
      lon: a[4],
      elevFt: a[5],
      country: a[6],
      city: a[7],
      iata: a[8],
      runways,
      freqs,
      towered: freqs.some((f) => TOWER_TYPES.has(f.type.toUpperCase())),
      paved: runways.some((r) => PAVED.test(r.surface)),
      longestFt: Math.max(0, ...runways.map((r) => r.lengthFt ?? 0)),
    };
  });
  const navaids = raw.navaids.map(
    (n): Navaid => ({ ident: n[0], name: n[1], type: n[2], freqKhz: n[3], lat: n[4], lon: n[5], elevFt: n[6] }),
  );
  const byIdent = new Map(airports.map((a) => [a.ident.toUpperCase(), a]));
  for (const a of airports) if (a.iata && !byIdent.has(a.iata)) byIdent.set(a.iata.toUpperCase(), a);
  const navaidsByIdent = new Map<string, Navaid[]>();
  for (const n of navaids) {
    const k = n.ident.toUpperCase();
    navaidsByIdent.set(k, [...(navaidsByIdent.get(k) ?? []), n]);
  }
  return { airports, navaids, byIdent, navaidsByIdent, generated: raw.generated, region: raw.region };
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae');

/** Søk på ident, IATA, navn eller sted. Eksakt ident-treff først. */
export function searchAirports(db: AeroDb, q: string, limit = 30): Airport[] {
  const query = fold(q.trim());
  if (!query) return [];
  const scored: [number, Airport][] = [];
  for (const a of db.airports) {
    const id = a.ident.toLowerCase();
    let score = -1;
    if (id === query || a.iata.toLowerCase() === query) score = 100;
    else if (id.startsWith(query)) score = 80;
    else {
      const name = fold(a.name);
      const city = fold(a.city);
      if (name.startsWith(query) || city.startsWith(query)) score = 60;
      else if (name.includes(query) || city.includes(query)) score = 40;
    }
    if (score >= 0) {
      score += a.type === 'L' ? 3 : a.type === 'M' ? 2 : 0;
      scored.push([score, a]);
    }
  }
  return scored
    .sort((x, y) => y[0] - x[0] || x[1].ident.localeCompare(y[1].ident))
    .slice(0, limit)
    .map((x) => x[1]);
}

export function nearestAirports(
  db: AeroDb,
  p: LatLon,
  n = 10,
  filter: (a: Airport) => boolean = () => true,
): { airport: Airport; dist: number }[] {
  // Grovfilter på breddegrad først (1° ≈ 60 NM) for fart.
  const out: { airport: Airport; dist: number }[] = [];
  for (const a of db.airports) {
    if (Math.abs(a.lat - p.lat) > 3 || !filter(a)) continue;
    out.push({ airport: a, dist: distanceNm(p, a) });
  }
  return out.sort((x, y) => x.dist - y.dist).slice(0, n);
}

export const AIRPORT_TYPE_TEXT: Record<Airport['type'], string> = {
  L: 'Stor lufthavn',
  M: 'Lufthavn',
  S: 'Flyplass',
  W: 'Sjøflyhavn',
};

export const ftToM = (ft: number | null) => (ft === null ? null : Math.round(ft * 0.3048));
