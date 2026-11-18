// VFR-rapporteringspunkter og georefererte VFR-rutekart fra AIP Norge.

export interface VfrPoint {
  n: string;
  lat: number;
  lon: number;
  /** Flyplass(er) punktet hører til. */
  ad: string[];
  /** 1 = obligatorisk (fylt ▲), 0 = på forespørsel (åpen △), mangler = ukjent. */
  c?: 0 | 1;
  /** Type per flyplass (et punkt kan være obligatorisk for én flyplass og frivillig for en annen). */
  cad?: Record<string, 0 | 1>;
  /** 'table' = koordinat fra kartets tabell, 'chart' = posisjon lest fra symbolet på kartet. */
  src?: 'table' | 'chart';
  /** Nøyaktighet (m) når posisjonen er lest fra kartet. */
  acc?: number;
  /** Høyde ved punktet («STEINVIK MAX 2000»). */
  alt?: { max?: number; min?: number };
  /** Venteområde (HLDG). */
  hold?: 1;
}

export interface VfrChartLink {
  title: string;
  page: string;
  url: string;
}

export interface VfrRoute {
  ad: string;
  chart: string;
  /** Linjen som [lat, lon], fra det georefererte AIP-rutekartet. */
  pts: [number, number][];
  arrowStart: boolean;
  arrowEnd: boolean;
  /** Høyde lest langs linjen («MAX 1000»), om entydig. */
  alt: { max?: number; min?: number } | null;
  /** Felles høydemerknad på kartet. */
  note?: string;
  accuracyM: number;
}

export interface VfrData {
  edition: string;
  points: VfrPoint[];
  charts: Record<string, VfrChartLink[]>;
  routes: VfrRoute[];
}

let p: Promise<VfrData | null> | null = null;
export function loadVfr(): Promise<VfrData | null> {
  p ??= fetch('./data/vfr.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d ? { routes: [], charts: {}, points: [], ...d } : null))
    .catch(() => null);
  return p;
}
