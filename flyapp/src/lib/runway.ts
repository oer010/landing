// Rullebaneretninger: rettvisende og magnetisk kurs for hver baneende.

import type { Runway } from './data';
import { bearingTrue, norm360 } from './geo';

export interface RunwayEnd {
  ident: string;
  trueHdg: number | null;
  magHdg: number | null;
}

/** Retning for begge ender. Bruker kursen i databasen, ellers baneendene, ellers banenummeret. */
export function runwayEnds(r: Runway, decl: number): [RunwayEnd, RunwayEnd] {
  let t = r.leHeadingTrue;
  if (t === null && r.leEnd && r.heEnd) t = bearingTrue(r.leEnd, r.heEnd);
  if (t === null) {
    const m = r.le.match(/^(\d{1,2})/);
    if (m) t = norm360(+m[1] * 10 + decl);
  }
  const mk = (ident: string, tr: number | null): RunwayEnd => ({ ident, trueHdg: tr, magHdg: tr === null ? null : norm360(tr - decl) });
  return [mk(r.le, t), mk(r.he, t === null ? null : norm360(t + 180))];
}

export const fmtDeg = (v: number | null) => (v === null ? '—' : `${String(Math.round(v) % 360 || 360).padStart(3, '0')}°`);
