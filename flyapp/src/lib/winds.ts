// Vind og temperatur i høyden fra Open-Meteo (gratis, ingen nøkkel, tillater
// kall direkte fra nettleseren). Modellen velges automatisk ("best match"),
// i Norden typisk MET Nordic / ECMWF / ICON.

import { norm360, type LatLon } from './geo';
import type { Wind } from './navlog';

export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600] as const;

export interface WindAloft extends Wind {
  tempC: number | null;
}

interface HourlyBlock {
  time: string[];
  [key: string]: (number | null)[] | string[];
}

export interface OpenMeteoPoint {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: HourlyBlock;
}

export function openMeteoUrl(points: LatLon[], forecastDays: number): string {
  const vars: string[] = ['wind_speed_10m', 'wind_direction_10m', 'temperature_2m'];
  for (const l of PRESSURE_LEVELS)
    vars.push(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`, `temperature_${l}hPa`);
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lon.toFixed(3)).join(','),
    hourly: vars.join(','),
    wind_speed_unit: 'kn',
    timezone: 'GMT',
    past_days: '1',
    forecast_days: String(Math.min(16, Math.max(1, forecastDays))),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

const toUV = (dir: number, spd: number) => {
  const r = (dir * Math.PI) / 180;
  // Retningen vinden kommer FRA.
  return { u: -spd * Math.sin(r), v: -spd * Math.cos(r) };
};
const fromUV = (u: number, v: number): Wind => ({
  speed: Math.hypot(u, v),
  dir: Math.hypot(u, v) < 0.05 ? 0 : norm360((Math.atan2(-u, -v) * 180) / Math.PI),
});

/** Nærmeste time i prognosen. */
export function hourIndex(times: string[], t: Date): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(Date.parse(`${times[i]}:00Z`) - t.getTime());
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return bestDiff <= 90 * 60000 ? best : -1;
}

/** Vind og temperatur i gitt høyde (ft MSL) og tid, interpolert vertikalt via u/v-komponenter. */
export function windAt(pt: OpenMeteoPoint, t: Date, altFt: number): WindAloft | null {
  const i = hourIndex(pt.hourly.time, t);
  if (i < 0) return null;
  const val = (k: string) => {
    const a = pt.hourly[k] as (number | null)[] | undefined;
    const v = a?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const surfaceFt = pt.elevation / 0.3048;
  const profile: { h: number; u: number; v: number; temp: number | null }[] = [];
  const ws10 = val('wind_speed_10m');
  const wd10 = val('wind_direction_10m');
  if (ws10 !== null && wd10 !== null) profile.push({ h: surfaceFt + 33, ...toUV(wd10, ws10), temp: val('temperature_2m') });
  for (const l of PRESSURE_LEVELS) {
    const gh = val(`geopotential_height_${l}hPa`);
    const ws = val(`wind_speed_${l}hPa`);
    const wd = val(`wind_direction_${l}hPa`);
    if (gh === null || ws === null || wd === null) continue;
    const h = gh / 0.3048;
    if (h <= surfaceFt + 50) continue; // nivå under bakken
    profile.push({ h, ...toUV(wd, ws), temp: val(`temperature_${l}hPa`) });
  }
  if (!profile.length) return null;
  profile.sort((a, b) => a.h - b.h);
  let lo = profile[0];
  let hi = profile[profile.length - 1];
  if (altFt <= lo.h) hi = lo;
  else if (altFt >= hi.h) lo = hi;
  else
    for (let k = 1; k < profile.length; k++)
      if (profile[k].h >= altFt) {
        lo = profile[k - 1];
        hi = profile[k];
        break;
      }
  const f = hi.h === lo.h ? 0 : (altFt - lo.h) / (hi.h - lo.h);
  const lerp = (a: number, b: number) => a + (b - a) * f;
  const w = fromUV(lerp(lo.u, hi.u), lerp(lo.v, hi.v));
  const temp = lo.temp !== null && hi.temp !== null ? lerp(lo.temp, hi.temp) : (lo.temp ?? hi.temp);
  return { ...w, tempC: temp };
}

export interface LegWindRequest {
  point: LatLon;
  time: Date;
  /** Høyde for dette legget (ft MSL); ellers felles høyde. */
  altFt?: number;
}

/** Henter vind for hvert legg (ett kall for alle punktene). */
export async function fetchLegWinds(reqs: LegWindRequest[], altFt: number, fetchFn: typeof fetch = fetch): Promise<(WindAloft | null)[]> {
  if (!reqs.length) return [];
  const last = Math.max(...reqs.map((r) => r.time.getTime()));
  const days = Math.ceil((last - Date.now()) / 86400000) + 1;
  if (days > 16) throw new Error('Avgangen er mer enn 16 døgn fram i tid – prognosen rekker ikke så langt.');
  const res = await fetchFn(openMeteoUrl(reqs.map((r) => r.point), days));
  if (res.status === 429) throw new Error('Prognosetjenesten er travel akkurat nå (for mange forespørsler). Prøv igjen litt senere.');
  if (!res.ok) throw new Error(`Prognosetjenesten svarte ${res.status}`);
  const body = (await res.json()) as OpenMeteoPoint | OpenMeteoPoint[];
  const pts = Array.isArray(body) ? body : [body];
  return reqs.map((r, i) => (pts[i] ? windAt(pts[i], r.time, r.altFt ?? altFt) : null));
}
