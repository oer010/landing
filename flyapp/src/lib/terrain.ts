// Terrenghøyder fra Kartverket (ws.geonorge.no/hoydedata, DTM 1 m for Norge).
// Brukes til høydeprofil langs ruten og terrengvarsel foran flyet.

import { bearingTrue, destination, distanceNm, type LatLon } from './geo';

const API = 'https://ws.geonorge.no/hoydedata/v1/punkt';
const M_TO_FT = 3.28084;
const cache = new Map<string, number | null>();
const key = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

/** Terrenghøyde (ft) for punktene; null der det ikke finnes data (sjø/utland gir 0 eller null). */
export async function elevationsFt(pts: LatLon[], fetcher: typeof fetch = fetch): Promise<(number | null)[]> {
  const missing = [...new Map(pts.filter((p) => !cache.has(key(p))).map((p) => [key(p), p])).values()];
  const batches: LatLon[][] = [];
  for (let i = 0; i < missing.length; i += 50) batches.push(missing.slice(i, i + 50));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      const url = `${API}?koordsys=4258&punkter=${encodeURIComponent(JSON.stringify(b.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)])))}`;
      const r = await fetcher(url);
      if (!r.ok) throw new Error(`Høydedata: HTTP ${r.status}`);
      const d = (await r.json()) as { punkter: { z: number | null }[] };
      b.forEach((p, i) => {
        const z = d.punkter[i]?.z;
        cache.set(key(p), typeof z === 'number' ? Math.max(0, z) * M_TO_FT : null);
      });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return pts.map((p) => cache.get(key(p)) ?? null);
}

export interface TerrainSample {
  /** Distanse fra start (NM). */
  d: number;
  pos: LatLon;
  /** Høyeste terreng i korridoren (ft). */
  ft: number | null;
}

/** Høyeste terreng langs ruten i en korridor på ±`sideNm`, hver `stepNm`. */
export async function routeTerrain(wps: LatLon[], stepNm = 0.3, sideNm = 1, fetcher: typeof fetch = fetch): Promise<TerrainSample[]> {
  const samples: { d: number; pos: LatLon; probes: LatLon[] }[] = [];
  let cum = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1];
    const b = wps[i];
    const len = distanceNm(a, b);
    const brg = bearingTrue(a, b);
    const n = Math.max(1, Math.ceil(len / stepNm));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const pos = destination(a, brg, (len * k) / n);
      const probes = [pos, destination(pos, (brg + 90) % 360, sideNm), destination(pos, (brg + 270) % 360, sideNm), destination(pos, (brg + 90) % 360, sideNm / 2), destination(pos, (brg + 270) % 360, sideNm / 2)];
      samples.push({ d: cum + (len * k) / n, pos, probes });
    }
    cum += len;
  }
  const all = samples.flatMap((s) => s.probes);
  const z = await elevationsFt(all, fetcher);
  return samples.map((s, i) => {
    const vals = z.slice(i * 5, i * 5 + 5).filter((v): v is number => v !== null);
    return { d: s.d, pos: s.pos, ft: vals.length ? Math.max(...vals) : null };
  });
}

/** Høyeste terreng foran flyet innen `lookMin` minutter (±0.3 NM). */
export async function terrainAhead(
  pos: LatLon,
  trk: number,
  gsKt: number,
  lookMin = 2,
  fetcher: typeof fetch = fetch,
): Promise<{ ft: number; distNm: number; groundFt: number | null } | null> {
  const range = Math.max(1, (gsKt * lookMin) / 60);
  const pts: { p: LatLon; d: number }[] = [{ p: pos, d: 0 }];
  for (let d = 0.25; d <= range; d += 0.25)
    for (const off of [0, 0.3, -0.3]) {
      const c = destination(pos, trk, d);
      pts.push({ p: off ? destination(c, (trk + (off > 0 ? 90 : 270)) % 360, Math.abs(off)) : c, d });
    }
  const z = await elevationsFt(
    pts.map((x) => x.p),
    fetcher,
  );
  // Første punkt er bakken rett under flyet.
  const groundFt = z[0];
  let best: { ft: number; distNm: number; groundFt: number | null } | null = null;
  for (let i = 1; i < z.length; i++) {
    const v = z[i];
    if (v !== null && (!best || v > best.ft)) best = { ft: v, distNm: pts[i].d, groundFt };
  }
  return best ?? (groundFt !== null ? { ft: 0, distNm: 0, groundFt } : null);
}
