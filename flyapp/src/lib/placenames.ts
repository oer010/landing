// Nærmeste stedsnavn fra Kartverkets stedsnavn-API (ws.geonorge.no, åpent, tillater
// kall fra nettleser). Velger navn som er nyttige fra lufta: tettsteder, fjorder,
// øyer, fjell og vann foran gårder, hauger og veinavn – men nær foran langt unna.

import type { LatLon } from './geo';

/** Vekt per navneobjekttype (høy = synlig/nyttig som rutepunkt). */
const WEIGHT: Record<string, number> = {
  By: 5, Tettsted: 5, Flyplass: 5, Fjord: 5, 'Fjord i sjø': 5,
  'Øy': 4.5, 'Øy i sjø': 4.5, Tettsteddel: 4, Bygd: 4, Innsjø: 4, Halvøy: 4, 'Halvøy i sjø': 4,
  Sund: 4, 'Sund i sjø': 4, Fjell: 4, 'Fjellområde': 4, Bre: 4,
  Grend: 3.5, Vann: 3, Topp: 3, Dal: 3, Kirke: 3, Fyr: 3, Skjærgård: 3,
  'Nes i sjø': 2.5, Nes: 2.5, 'Våg i sjø': 2.5, Vik: 2.5, Elv: 2.5,
  Gard: 2, 'Høyde': 2, Holme: 2, 'Holme i sjø': 2, Bru: 2, Stasjon: 2,
  'Ås': 1.5, Rygg: 1.5, Berg: 1.5, Tjern: 1.5, 'Skjær i sjø': 1,
};
const IGNORE = new Set(['Adressenavn', 'Bruk', 'Annen terrengdetalj', 'Tunnel', 'Sti', 'Eiendom', 'Boligfelt']);

export interface PlaceName {
  name: string;
  type: string;
  distM: number;
}

interface GeonorgeHit {
  navneobjekttype: string;
  meterFraPunkt: number;
  stedsnavn: { skrivemåte: string }[];
}

/** Velger beste navn: vekt minus 0,6 per km avstand. */
export function pickPlaceName(hits: GeonorgeHit[]): PlaceName | null {
  let best: { s: number; p: PlaceName } | null = null;
  for (const h of hits) {
    if (IGNORE.has(h.navneobjekttype)) continue;
    const name = h.stedsnavn?.[0]?.skrivemåte;
    if (!name) continue;
    const s = (WEIGHT[h.navneobjekttype] ?? 1) - (h.meterFraPunkt / 1000) * 0.6;
    if (!best || s > best.s) best = { s, p: { name, type: h.navneobjekttype, distM: h.meterFraPunkt } };
  }
  return best?.p ?? null;
}

const cache = new Map<string, PlaceName | null>();

export async function nearestPlaceName(p: LatLon, fetchFn: typeof fetch = fetch): Promise<PlaceName | null> {
  const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key)!;
  const q = new URLSearchParams({
    nord: p.lat.toFixed(5),
    ost: p.lon.toFixed(5),
    koordsys: '4258',
    utkoordsys: '4258',
    radius: '5000',
    treffPerSide: '500',
    side: '1',
    filtrer: 'navn.stedsnavn.skrivemåte,navn.navneobjekttype,navn.meterFraPunkt',
  });
  const res = await fetchFn(`https://ws.geonorge.no/stedsnavn/v1/punkt?${q}`);
  if (!res.ok) throw new Error(`Stedsnavn svarte ${res.status}`);
  const data = (await res.json()) as { navn?: GeonorgeHit[] };
  const best = pickPlaceName(data.navn ?? []);
  cache.set(key, best);
  return best;
}

/** Kort visningsnavn for et rutepunkt. */
export const shortName = (n: string) => (n.length > 16 ? n.slice(0, 15) + '…' : n);
