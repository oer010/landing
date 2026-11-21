// Isogoner: linjer med lik misvisning (hver hele grad), som på VFR-kartene.
// Beregnet med World Magnetic Model 2025 for dagens dato.

import L from 'leaflet';
import { declination, fmtVar } from '../lib/mag';
import { state } from './state';

let layer: L.LayerGroup;
let map: L.Map;

export function initIsogons(m: L.Map): void {
  map = m;
  layer = L.layerGroup().addTo(map);
  map.on('moveend', render);
  state.on('settings', render);
  render();
}

type P = [number, number];

/** Marching squares for ett nivå på et rutenett (lat × lon). */
export function contour(grid: number[][], lats: number[], lons: number[], level: number): P[][] {
  const segs: [P, P][] = [];
  const lerp = (a: number, b: number, va: number, vb: number) => a + ((level - va) / (vb - va)) * (b - a);
  for (let i = 0; i < lats.length - 1; i++)
    for (let j = 0; j < lons.length - 1; j++) {
      const v = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]];
      const c = [[lats[i], lons[j]], [lats[i], lons[j + 1]], [lats[i + 1], lons[j + 1]], [lats[i + 1], lons[j]]] as P[];
      const pts: P[] = [];
      for (let k = 0; k < 4; k++) {
        const a = v[k];
        const b = v[(k + 1) % 4];
        if ((a < level) !== (b < level)) {
          const ca = c[k];
          const cb = c[(k + 1) % 4];
          pts.push([lerp(ca[0], cb[0], a, b), lerp(ca[1], cb[1], a, b)]);
        }
      }
      if (pts.length === 2) segs.push([pts[0], pts[1]]);
      else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  // Koble segmentene til linjer.
  const key = (p: P) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const lines: P[][] = [];
  const used = new Set<number>();
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => s.forEach((p) => byEnd.set(key(p), [...(byEnd.get(key(p)) ?? []), i])));
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line: P[] = [segs[i][0], segs[i][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? line[line.length - 1] : line[0];
        const next = (byEnd.get(key(end)) ?? []).find((n) => !used.has(n));
        if (next === undefined) break;
        used.add(next);
        const s = segs[next];
        const other = key(s[0]) === key(end) ? s[1] : s[0];
        if (dir === 1) line.push(other);
        else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

function render(): void {
  if (!layer) return;
  layer.clearLayers();
  if (!state.settings.showIsogons || map.getZoom() < 4) return;
  const b = map.getBounds().pad(0.15);
  const N = 36;
  const lats = Array.from({ length: N + 1 }, (_, i) => b.getSouth() + ((b.getNorth() - b.getSouth()) * i) / N);
  const lons = Array.from({ length: N + 1 }, (_, j) => b.getWest() + ((b.getEast() - b.getWest()) * j) / N);
  const grid = lats.map((lat) => lons.map((lon) => declination({ lat: Math.max(-89, Math.min(89, lat)), lon })));
  const flat = grid.flat();
  const lo = Math.ceil(Math.min(...flat));
  const hi = Math.floor(Math.max(...flat));
  // Ved lite utsnitt: hver halve grad.
  const step = hi - lo < 2 ? 0.5 : hi - lo > 25 ? 2 : 1;
  for (let lv = Math.ceil(lo / step) * step; lv <= hi; lv += step) {
    for (const line of contour(grid, lats, lons, lv)) {
      if (line.length < 2) continue;
      L.polyline(line, { color: '#0e7490', weight: 1.6, opacity: 0.8, dashArray: '10 6', interactive: false }).addTo(layer);
      // Etikett midt på linjen.
      const mid = line[Math.floor(line.length / 2)];
      L.marker(mid, {
        icon: L.divIcon({ className: 'isogon-lbl', html: `<span>${fmtVar(lv).replace('.0°', '°')}</span>`, iconSize: [52, 18], iconAnchor: [26, 9] }),
        interactive: false,
        keyboard: false,
      }).addTo(layer);
    }
  }
}
