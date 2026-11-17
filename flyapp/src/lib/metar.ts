// METAR/TAF fra aviationweather.gov Data API (direkte i iPhone-appen, via /awc-proxy i nettleser).

import { awcBase } from './platform';

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | 'UNK';

export interface CloudLayer {
  cover: string;
  base: number | null;
}

export interface Metar {
  icaoId: string;
  obsTime: number;
  rawOb: string;
  temp: number | null;
  dewp: number | null;
  wdir: number | 'VRB' | null;
  wspd: number | null;
  wgst?: number | null;
  visib: string | number | null;
  altim: number | null;
  clouds: CloudLayer[];
  cover?: string;
  fltCat?: FlightCategory;
  lat: number;
  lon: number;
  name: string;
}

export interface Taf {
  icaoId: string;
  rawTAF: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
}

export const CATEGORY_COLORS: Record<FlightCategory, string> = {
  VFR: '#22c55e',
  MVFR: '#3b82f6',
  IFR: '#ef4444',
  LIFR: '#d946ef',
  UNK: '#9ca3af',
};

export const CATEGORY_TEXT: Record<FlightCategory, string> = {
  VFR: 'VFR – sikt > 5 SM og tak > 3000 ft',
  MVFR: 'Marginal VFR – sikt 3–5 SM eller tak 1000–3000 ft',
  IFR: 'IFR – sikt 1–3 SM eller tak 500–1000 ft',
  LIFR: 'Lav IFR – sikt < 1 SM eller tak < 500 ft',
  UNK: 'Ukjent',
};

/** Sikt i statute miles fra AWC-feltet ("6+", "1/2", 10, ...). */
export function visibilitySm(v: Metar['visib']): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = v.replace('+', '').trim();
  const frac = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (frac) return (frac[1] ? +frac[1] : 0) + +frac[2] / +frac[3];
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Laveste BKN/OVC/VV-lag (ft AGL), eller null om ingen tak. */
export function ceilingFt(clouds: CloudLayer[]): number | null {
  const bases = clouds
    .filter((c) => ['BKN', 'OVC', 'OVX', 'VV'].includes(c.cover) && c.base !== null)
    .map((c) => c.base as number);
  return bases.length ? Math.min(...bases) : null;
}

/** FAA/AWC flygekategori fra sikt og tak (brukes når fltCat mangler). */
export function flightCategory(visSm: number | null, ceiling: number | null): FlightCategory {
  if (visSm === null && ceiling === null) return 'UNK';
  const v = visSm ?? 99;
  const c = ceiling ?? 99999;
  if (v < 1 || c < 500) return 'LIFR';
  if (v < 3 || c < 1000) return 'IFR';
  if (v <= 5 || c <= 3000) return 'MVFR';
  return 'VFR';
}

export function categoryOf(m: Metar): FlightCategory {
  if (m.fltCat && m.fltCat in CATEGORY_COLORS) return m.fltCat;
  return flightCategory(visibilitySm(m.visib), ceilingFt(m.clouds ?? []));
}

/** Kort, lesbar norsk tolkning av en METAR. */
export function decodeMetar(m: Metar): string[] {
  const out: string[] = [];
  if (m.wspd !== null && m.wspd !== undefined) {
    if (m.wspd === 0) out.push('Vind: stille');
    else {
      const dir = m.wdir === 'VRB' ? 'variabel' : `${String(m.wdir).padStart(3, '0')}°`;
      out.push(`Vind: ${dir} ${m.wspd} kt${m.wgst ? `, kast ${m.wgst} kt` : ''}`);
    }
  }
  const vis = visibilitySm(m.visib);
  if (vis !== null) {
    const plus = typeof m.visib === 'string' && m.visib.includes('+');
    out.push(`Sikt: ${plus ? '≥ 10 km' : `${(vis * 1.609).toFixed(vis < 3 ? 1 : 0)} km`}`);
  }
  if (m.cover === 'CAVOK') out.push('Skyer: CAVOK');
  else if (m.clouds?.length)
    out.push('Skyer: ' + m.clouds.map((c) => `${c.cover}${c.base !== null ? ` ${c.base} ft` : ''}`).join(', '));
  const ceil = ceilingFt(m.clouds ?? []);
  if (ceil !== null) out.push(`Skytak: ${ceil} ft`);
  if (m.temp !== null && m.temp !== undefined) out.push(`Temp/duggpunkt: ${m.temp}° / ${m.dewp ?? '–'}°`);
  if (m.altim) out.push(`QNH: ${Math.round(m.altim)} hPa`);
  return out;
}

export const metarAgeMin = (m: Metar, now = Date.now()): number => Math.round((now / 1000 - m.obsTime) / 60);

const cache = new Map<string, { t: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

async function getJson<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < TTL) return hit.data as T;
  const res = await fetch(`${awcBase()}${path}`);
  if (res.status === 204) return [] as T;
  if (!res.ok) throw new Error(`Værtjenesten svarte ${res.status}`);
  const data = (await res.json()) as T;
  cache.set(path, { t: Date.now(), data });
  return data;
}

export const fetchMetars = (ids: string[]) =>
  ids.length ? getJson<Metar[]>(`metar?ids=${encodeURIComponent(ids.join(','))}&format=json`) : Promise.resolve([]);

export const fetchTafs = (ids: string[]) =>
  ids.length ? getJson<Taf[]>(`taf?ids=${encodeURIComponent(ids.join(','))}&format=json`) : Promise.resolve([]);

/** bbox: sør, vest, nord, øst */
export const fetchMetarsInBox = (s: number, w: number, n: number, e: number) =>
  getJson<Metar[]>(`metar?bbox=${[s, w, n, e].map((v) => v.toFixed(2)).join(',')}&format=json`);
