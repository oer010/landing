// VFR-rapporteringspunkter og georefererte VFR-rutekart fra AIP Norge.

export interface VfrPoint {
  n: string;
  lat: number;
  lon: number;
  /** Flyplass(er) punktet hører til. */
  ad: string[];
}

export interface VfrChartLink {
  title: string;
  page: string;
  url: string;
}

export interface VfrOverlay {
  ad: string;
  title: string;
  page: string;
  img: string;
  /** Hjørner [lat, lon]: øverst venstre, øverst høyre, nederst venstre. */
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
  accuracyM: number;
  controlPoints: number;
}

export interface VfrData {
  edition: string;
  points: VfrPoint[];
  charts: Record<string, VfrChartLink[]>;
  overlays: VfrOverlay[];
}

let p: Promise<VfrData | null> | null = null;
export function loadVfr(): Promise<VfrData | null> {
  p ??= fetch('./data/vfr.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d ? { overlays: [], charts: {}, points: [], ...d } : null))
    .catch(() => null);
  return p;
}
