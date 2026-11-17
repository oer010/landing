import * as geomagnetism from 'geomagnetism';
import type { LatLon } from './geo';

let cached: { key: string; model: ReturnType<typeof geomagnetism.model> } | null = null;

/** Misvisning (deklinasjon) i grader fra World Magnetic Model. Øst = positiv. */
export function declination(p: LatLon, date = new Date()): number {
  const key = date.toISOString().slice(0, 10);
  if (!cached || cached.key !== key) cached = { key, model: geomagnetism.model(date, { allowOutOfBoundsModel: true }) };
  return cached.model.point([p.lat, p.lon]).decl;
}

/** Magnetisk = rettvisende − østlig misvisning. */
export const trueToMag = (trueDeg: number, decl: number): number => (((trueDeg - decl) % 360) + 360) % 360;
export const magToTrue = (magDeg: number, decl: number): number => (((magDeg + decl) % 360) + 360) % 360;

export const fmtVar = (decl: number): string => `${Math.abs(decl).toFixed(1)}°${decl >= 0 ? 'Ø' : 'V'}`;
