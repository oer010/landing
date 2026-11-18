// Norsk luftrom (fra AIP Norge via relet/pg-xc). Typer, stil, høydegrenser
// og geometri: hvilke luftrom ligger over et punkt, og hvilke krysser ruten.

import { bearingTrue, destination, distanceNm, type LatLon } from './geo';

export interface Airspace {
  n: string;
  /** Klasse: C, D, G, R (restriksjon/forbudt), Q (fare), Luftsport */
  c: string;
  /** Nedre/øvre grense i ft AMSL (FL omregnet ×100 i kilden). */
  lo: number;
  hi: number;
  loFl: string | null;
  hiFl: string | null;
  f: string | null;
  notam: 0 | 1;
  amc: 0 | 1;
  src: string | null;
  /** Polygoner (ytterring) som [lon, lat]. */
  g: [number, number][][];
}

export interface AirspaceDb {
  airac: string;
  generated: string;
  airspaces: (Airspace & { bbox: [number, number, number, number]; kind: AirspaceKind })[];
}

export type AirspaceKind = 'CTR' | 'TMA' | 'CTA' | 'TIZ' | 'TIA' | 'RMZ' | 'ATZ' | 'R' | 'P' | 'D' | 'SPORT' | 'OTHER';

export function kindOf(a: Pick<Airspace, 'n' | 'c'>): AirspaceKind {
  const m = a.n.match(/\b(CTR|TMA|CTA|TIZ|TIA|RMZ|TMZ|ATZ)\b/i);
  if (m) {
    const k = m[1].toUpperCase();
    return (k === 'TMZ' ? 'RMZ' : k) as AirspaceKind;
  }
  if (/^ENP/i.test(a.n)) return 'P';
  if (a.c === 'R' || /^ENR/i.test(a.n)) return 'R';
  if (a.c === 'Q' || /^END/i.test(a.n)) return 'D';
  if (a.c === 'Luftsport') return 'SPORT';
  return 'OTHER';
}

export const KIND_TEXT: Record<AirspaceKind, string> = {
  CTR: 'Kontrollsone (CTR)',
  TMA: 'Terminalområde (TMA)',
  CTA: 'Kontrollområde (CTA)',
  TIZ: 'Trafikkinformasjonssone (TIZ)',
  TIA: 'Trafikkinformasjonsområde (TIA)',
  RMZ: 'Radiopåbudt sone (RMZ/TMZ)',
  ATZ: 'Flyplassens trafikksone (ATZ)',
  R: 'Restriksjonsområde',
  P: 'Forbudt område',
  D: 'Fareområde',
  SPORT: 'Luftsportsområde',
  OTHER: 'Luftrom',
};

/** Hva krever luftrommet av en VFR-flyger (kort, veiledende). */
export const KIND_ADVICE: Record<AirspaceKind, string> = {
  CTR: 'Klarering fra TWR påkrevd',
  TMA: 'Klarering påkrevd (klasse C/D)',
  CTA: 'Klarering påkrevd',
  TIZ: 'Radiokontakt og posisjonsmelding til AFIS',
  TIA: 'Radiokontakt med AFIS anbefalt/påkrevd',
  RMZ: 'Radio påbudt (og transponder ved TMZ)',
  ATZ: 'Kontakt flyplassen',
  R: 'Inngang forbudt/begrenset – sjekk AIP/NOTAM',
  P: 'Inngang forbudt',
  D: 'Mulig farlig aktivitet – sjekk NOTAM/status',
  SPORT: 'Luftsportsaktivitet – vær oppmerksom',
  OTHER: 'Sjekk AIP',
};

export interface AirspaceStyle {
  color: string;
  fillOpacity: number;
  weight: number;
  dashArray?: string;
}

export const KIND_STYLE: Record<AirspaceKind, AirspaceStyle> = {
  CTR: { color: '#e11d48', fillOpacity: 0.12, weight: 2.5, dashArray: '10 5' },
  ATZ: { color: '#e11d48', fillOpacity: 0.08, weight: 2, dashArray: '4 4' },
  TMA: { color: '#2563eb', fillOpacity: 0.04, weight: 1.5 },
  CTA: { color: '#2563eb', fillOpacity: 0.03, weight: 1.2 },
  TIZ: { color: '#7c3aed', fillOpacity: 0.1, weight: 2.2, dashArray: '6 4' },
  TIA: { color: '#7c3aed', fillOpacity: 0.04, weight: 1.5 },
  RMZ: { color: '#0891b2', fillOpacity: 0.06, weight: 2.5, dashArray: '2 6' },
  R: { color: '#dc2626', fillOpacity: 0.18, weight: 2 },
  P: { color: '#991b1b', fillOpacity: 0.3, weight: 2.5 },
  D: { color: '#ea580c', fillOpacity: 0.07, weight: 1.5, dashArray: '6 4' },
  SPORT: { color: '#16a34a', fillOpacity: 0.06, weight: 1.5, dashArray: '3 5' },
  OTHER: { color: '#64748b', fillOpacity: 0.04, weight: 1 },
};

export function buildAirspaceDb(raw: { airac: string; generated: string; airspaces: Airspace[] }): AirspaceDb {
  return {
    airac: raw.airac,
    generated: raw.generated,
    airspaces: raw.airspaces.map((a) => {
      let w = 180, s = 90, e = -180, n = -90;
      for (const ring of a.g)
        for (const [x, y] of ring) {
          if (x < w) w = x;
          if (x > e) e = x;
          if (y < s) s = y;
          if (y > n) n = y;
        }
      return { ...a, bbox: [w, s, e, n] as [number, number, number, number], kind: kindOf(a) };
    }),
  };
}

let dbPromise: Promise<AirspaceDb | null> | null = null;
export function loadAirspace(): Promise<AirspaceDb | null> {
  dbPromise ??= fetch('./data/airspace.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => (raw ? buildAirspaceDb(raw) : null))
    .catch(() => null);
  return dbPromise;
}

/** "GND", "2500 ft", "FL 95" */
export function fmtLimit(ft: number, fl: string | null): string {
  if (ft <= 0) return 'GND';
  if (ft >= 99999) return 'UNL';
  if (fl) return `FL ${+fl}`;
  return `${ft} ft`;
}
/** Øvre grense mangler/ugyldig i kildedata → ukjent (regnes som ubegrenset for sikkerhets skyld). */
export const upperKnown = (a: Pick<Airspace, 'lo' | 'hi'>) => a.hi > a.lo;
export const effectiveHi = (a: Pick<Airspace, 'lo' | 'hi'>) => (upperKnown(a) ? a.hi : Infinity);
export const fmtLimits = (a: Airspace) => `${fmtLimit(a.lo, a.loFl)} – ${upperKnown(a) ? fmtLimit(a.hi, a.hiFl) : 'øvre grense: se AIP'}`;

/** Ray casting på lon/lat (tilstrekkelig for små polygoner). */
export function pointInRing(p: LatLon, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(a: AirspaceDb['airspaces'][number], p: LatLon): boolean {
  const [w, s, e, n] = a.bbox;
  if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) return false;
  return a.g.some((ring) => pointInRing(p, ring));
}

/** Alle luftrom over et punkt, lavest først. */
export function airspacesAt(db: AirspaceDb, p: LatLon) {
  return db.airspaces.filter((a) => contains(a, p)).sort((x, y) => x.lo - y.lo || x.hi - y.hi);
}

export interface RouteAirspace {
  airspace: AirspaceDb['airspaces'][number];
  /** Høyden på legget der luftrommet treffes. */
  altFt: number;
  /** Distanse fra start til første punkt inne i luftrommet (NM). */
  atNm: number;
}

/**
 * Luftrom som berøres langs ruten i gitt høyde (ft MSL), i rekkefølge.
 * Ruten samples hver `stepNm`; høydegrensene tolkes som MSL (GND = 0).
 */
export function airspacesAlongRoute(db: AirspaceDb, wps: LatLon[], altFt: number | number[], stepNm = 0.5): RouteAirspace[] {
  const hit = new Map<number, [number, number]>();
  let done = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1];
    const b = wps[i];
    const d = distanceNm(a, b);
    const brg = bearingTrue(a, b);
    const alt = Array.isArray(altFt) ? (altFt[i - 1] ?? altFt[altFt.length - 1]) : altFt;
    const n = Math.max(1, Math.ceil(d / stepNm));
    for (let k = 0; k <= n; k++) {
      const along = (d * k) / n;
      const p = k === 0 ? a : k === n ? b : destination(a, brg, along);
      db.airspaces.forEach((as, idx) => {
        if (hit.has(idx) || alt < as.lo || alt >= effectiveHi(as)) return;
        if (contains(as, p)) hit.set(idx, [done + along, alt]);
      });
    }
    done += d;
  }
  return [...hit]
    .map(([idx, [atNm, alt]]) => ({ airspace: db.airspaces[idx], atNm, altFt: alt }))
    .sort((x, y) => x.atNm - y.atNm);
}

/** Alder på dataene i dager fra AIRAC-dato. */
export const airacAgeDays = (airac: string, now = new Date()) =>
  airac ? Math.floor((now.getTime() - Date.parse(`${airac}T00:00:00Z`)) / 86400000) : Infinity;

/**
 * Er luftromsdataene eldre enn gjeldende AIP-utgave? Norge gir ikke ut ny AIP hver AIRAC,
 * så alder i dager alene sier lite. Uten kjent utgave: grovt anslag (> 120 dager).
 */
export function airspaceStale(airac: string, currentEdition?: string, now = new Date()): boolean {
  if (!airac) return true;
  if (currentEdition) return airac < currentEdition;
  return airacAgeDays(airac, now) > 120;
}
