// Luftfartshindre (master, tårn, piper, vindturbiner …) fra OpenStreetMap, der
// Kartverkets NRL er importert. Lastes fra datagrenen og lagres for bruk uten nett.

import { bearingTrue, distanceNm, type LatLon } from './geo';

export type ObstacleType = 'M' | 'T' | 'C' | 'K' | 'W' | 'P' | 'O';

export interface Obstacle {
  lat: number;
  lon: number;
  heightM: number;
  groundM: number | null;
  type: ObstacleType;
  lit: boolean;
}

export const OBSTACLE_TEXT: Record<ObstacleType, string> = {
  M: 'Mast',
  T: 'Tårn',
  C: 'Pipe',
  K: 'Kran',
  W: 'Vindturbin',
  P: 'Kraftmast',
  O: 'Hinder',
};

export const OBSTACLE_URL = 'https://raw.githubusercontent.com/oer010/landing/notam-data/obstacles.json';
const CACHE = 'vfr-offline-v1';

export interface ObstacleData {
  generated: string;
  source: string;
  obstacles: Obstacle[];
}

type Row = [number, number, number, number | null, ObstacleType, 0 | 1];

function parse(txt: string): ObstacleData {
  const d = JSON.parse(txt) as { generated: string; source: string; obstacles: Row[] };
  return {
    generated: d.generated,
    source: d.source,
    obstacles: d.obstacles.map(([lat, lon, heightM, groundM, type, lit]) => ({ lat, lon, heightM, groundM, type, lit: lit === 1 })),
  };
}

let p: Promise<ObstacleData | null> | null = null;

/** Nett først (ukentlig oppdatert), ellers lagret kopi. */
export function loadObstacles(): Promise<ObstacleData | null> {
  p ??= (async () => {
    const cache = 'caches' in self ? await caches.open(CACHE).catch(() => null) : null;
    try {
      const r = await fetch(`${OBSTACLE_URL}?d=${new Date().toISOString().slice(0, 10)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      await cache?.put(OBSTACLE_URL, new Response(txt, { headers: { 'content-type': 'application/json' } }));
      return parse(txt);
    } catch {
      const hit = await cache?.match(OBSTACLE_URL);
      return hit ? parse(await hit.text()) : null;
    }
  })().catch(() => null);
  return p;
}

const M_TO_FT = 3.28084;

/** Toppen av hinderet over havet (ft), om terrenghøyden er kjent. */
export const topFt = (o: Obstacle): number | null => (o.groundM === null ? null : Math.round((o.groundM + o.heightM) * M_TO_FT));

export interface ObstacleThreat {
  o: Obstacle;
  distNm: number;
  /** Klaring over toppen (ft); null når terrenghøyden ikke er kjent. */
  clearanceFt: number | null;
}

/**
 * Hindre foran flyet innen `lookMin` minutter, inntil `widthNm` til siden,
 * der flyet er under toppen + `marginFt`. Uten kjent terrenghøyde regnes hinderet
 * som en trussel når flyet er lavere enn hinderets høyde + 1500 ft over havet.
 */
export function obstaclesAhead(
  list: Obstacle[],
  pos: LatLon,
  trk: number,
  gsKt: number,
  altFt: number,
  o: { lookMin?: number; widthNm?: number; marginFt?: number } = {},
): ObstacleThreat[] {
  const { lookMin = 2, widthNm = 0.5, marginFt = 500 } = o;
  const range = Math.max(1, (gsKt * lookMin) / 60);
  const dLat = range / 60;
  const dLon = range / 60 / Math.cos((pos.lat * Math.PI) / 180);
  const out: ObstacleThreat[] = [];
  for (const ob of list) {
    if (Math.abs(ob.lat - pos.lat) > dLat || Math.abs(ob.lon - pos.lon) > dLon) continue;
    const d = distanceNm(pos, ob);
    if (d > range) continue;
    const rel = (((bearingTrue(pos, ob) - trk + 540) % 360) - 180) * (Math.PI / 180);
    const along = d * Math.cos(rel);
    const cross = Math.abs(d * Math.sin(rel));
    if (along < -0.1 || cross > widthNm) continue;
    const top = topFt(ob);
    const clearance = top === null ? null : altFt - top;
    const threat = clearance === null ? altFt < ob.heightM * M_TO_FT + 1500 : clearance < marginFt;
    if (threat) out.push({ o: ob, distNm: d, clearanceFt: clearance });
  }
  return out.sort((a, b) => a.distNm - b.distNm);
}
