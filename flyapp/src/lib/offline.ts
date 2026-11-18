// Kart uten nett: laster ned kartfliser fra Kartverket (åpne data, CC BY 4.0) til
// Cache Storage, så service workeren kan vise dem uten dekning i lufta.

export const KV_URL = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
export const OFFLINE_CACHE = 'vfr-offline-v1';
/** Typisk størrelse på en Kartverket-flis (topo, PNG). */
export const AVG_TILE_KB = 22;

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

export const tileUrl = (t: TileRef) => KV_URL.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));

export function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** [sør, vest, nord, øst] */
export type BBox = [number, number, number, number];

export function tilesInBox(b: BBox, zMin: number, zMax: number): TileRef[] {
  const out: TileRef[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lonToX(b[1], z);
    const x1 = lonToX(b[3], z);
    const y0 = latToY(b[2], z);
    const y1 = latToY(b[0], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}

/** Fliser i en korridor langs en linje (rute), med `widthNm` på hver side. */
export function tilesAlongRoute(pts: { lat: number; lon: number }[], widthNm: number, zMin: number, zMax: number): TileRef[] {
  const seen = new Set<string>();
  const out: TileRef[] = [];
  const add = (t: TileRef) => {
    const k = `${t.z}/${t.x}/${t.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const distDeg = Math.hypot(b.lat - a.lat, (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180));
    const steps = Math.max(1, Math.ceil((distDeg * 60) / Math.max(widthNm, 1)));
    for (let s = 0; s <= steps; s++) {
      const lat = a.lat + ((b.lat - a.lat) * s) / steps;
      const lon = a.lon + ((b.lon - a.lon) * s) / steps;
      const dLat = widthNm / 60;
      const dLon = widthNm / 60 / Math.cos((lat * Math.PI) / 180);
      for (const t of tilesInBox([lat - dLat, lon - dLon, lat + dLat, lon + dLon], zMin, zMax)) add(t);
    }
  }
  return out;
}

export const AREAS: Record<string, { label: string; box: BBox; zMax: number }> = {
  sor: { label: 'Sør-Norge', box: [57.8, 4.4, 64.6, 13.2], zMax: 10 },
  midt: { label: 'Trøndelag og Nordland sør', box: [62.5, 7.5, 67.5, 15.5], zMax: 10 },
  nord: { label: 'Nord-Norge', box: [66.5, 11.5, 71.3, 31.2], zMax: 9 },
};

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
  skipped: number;
}

/** Laster ned fliser som ikke allerede er lagret. Kan avbrytes med `signal`. */
export async function downloadTiles(tiles: TileRef[], onProgress: (p: DownloadProgress) => void, signal?: AbortSignal, concurrency = 6): Promise<DownloadProgress> {
  const cache = await caches.open(OFFLINE_CACHE);
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ikke støttet */
  }
  const p: DownloadProgress = { done: 0, total: tiles.length, failed: 0, skipped: 0 };
  let i = 0;
  let last = 0;
  const worker = async () => {
    while (i < tiles.length && !signal?.aborted) {
      const url = tileUrl(tiles[i++]);
      try {
        if (await cache.match(url)) p.skipped++;
        else {
          const r = await fetch(url, { mode: 'cors', signal });
          if (r.ok) await cache.put(url, r);
          else p.failed++;
        }
      } catch {
        if (signal?.aborted) return;
        p.failed++;
      }
      p.done++;
      if (Date.now() - last > 250) {
        last = Date.now();
        onProgress({ ...p });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  onProgress({ ...p });
  return p;
}

export async function offlineTileCount(): Promise<number> {
  if (!('caches' in self)) return 0;
  return (await (await caches.open(OFFLINE_CACHE)).keys()).length;
}

export async function clearOfflineTiles(): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
}

export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  const e = await navigator.storage?.estimate?.();
  return e ? { usedMb: Math.round((e.usage ?? 0) / 1e6), quotaMb: Math.round((e.quota ?? 0) / 1e6) } : null;
}
