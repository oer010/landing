// SIGMET/AIRMET i kartet: hele området meldingen gjelder (egne koordinater, hele FIR-en
// eller deler av den) med et merke som NOTAM-merkene, og vindskjærvarsler ved flyplassen.

import L from 'leaflet';
import { activeWarnings, warningAreas, type MetWarning } from '../lib/metwx';
import { h } from './dom';
import { getWarnings } from './panels/metwx';
import { state } from './state';

let layer: L.LayerGroup;
let list: MetWarning[] = [];
let opts: L.PopupOptions;
let layerMap: L.Map;

const COLOR = { SIGMET: '#be123c', AIRMET: '#7c3aed', 'WS WRNG': '#0891b2', OTHER: '#475569' } as const;

export function initWxLayer(map: L.Map, popupOpts: L.PopupOptions): void {
  opts = popupOpts;
  layerMap = map;
  layer = L.layerGroup().addTo(map);
  const refresh = () =>
    getWarnings()
      .then((w) => {
        list = activeWarnings(w);
        render();
      })
      .catch(() => undefined);
  void refresh();
  setInterval(refresh, 10 * 60e3);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
  state.on('settings', render);
  map.on('zoomend', render);
}

const fmt = (ft: number | null) => (ft === null ? '?' : ft === 0 ? 'SFC' : ft >= 10000 || ft % 1000 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : `${ft} ft`);
const hhmm = (d: Date | null) => (d ? `${d.toISOString().slice(11, 16)}Z` : '?');

/** FIR-grenser (Polaris FIR fra AIP ENR 2.1), lastet fra data/fir.json. */
let firs: Record<string, [number, number][]> = {};
void fetch('./data/fir.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (d) {
      firs = { ENOR: d.ENOR };
      render();
    }
  })
  .catch(() => undefined);

function firPolygons(fir: string): [number, number][][] {
  return firs[fir] ? [firs[fir]] : [];
}

function popup(w: MetWarning): HTMLElement {
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, `${w.kind} ${w.id}${w.phenomenon ? ` · ${w.phenomenon}` : ''}`),
    h('div', { class: 'p-kind' }, `${fmt(w.lowerFt)} – ${fmt(w.upperFt)} · gyldig ${hhmm(w.from)}–${hhmm(w.to)}${w.from && w.from.getTime() > Date.now() ? ' (kommende)' : ''}`),
    w.firArea ? h('div', { class: 'p-muted' }, w.firArea.entire && !w.firArea.cuts.length ? 'Gjelder hele FIR-en.' : 'Området er tegnet ut fra FIR-grensene (omtrentlig).') : null,
    h('pre', { class: 'wx-text' }, w.text),
    h('div', { class: 'p-muted' }, 'Kilde: MET Norge (api.met.no). Sjekk alltid briefing på ippc.no.'),
  );
}

function centroid(pts: [number, number][]): [number, number] {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
const area = (pts: [number, number][]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[1] * q[0] - q[1] * p[0]; }, 0)) / 2;

function render(): void {
  if (!layer) return;
  layer.clearLayers();
  if (!state.settings.showSigmet) return;
  const now = Date.now();
  const placed: L.Point[] = [];
  for (const w of list) {
    const color = COLOR[w.kind];
    const upcoming = !!w.from && w.from.getTime() > now;
    const bind = (l: L.Layer) => l.bindPopup(() => popup(w), { ...opts, maxHeight: 380 } as L.PopupOptions).addTo(layer);
    let badgeAt: [number, number] | null = null;
    if (w.kind === 'WS WRNG') {
      // Vindskjærvarsel for en flyplass (FIR-feltet er flyplassens ICAO-kode).
      const a = state.db.byIdent.get(w.fir);
      if (a) {
        bind(L.circle([a.lat, a.lon], { color, weight: 2, fillOpacity: 0.12, radius: 5 * 1852, dashArray: upcoming ? '6 5' : undefined, bubblingMouseEvents: false }));
        badgeAt = [a.lat, a.lon];
      }
    } else {
      const polys = warningAreas(w, firPolygons(w.fir));
      for (const poly of polys)
        bind(
          L.polygon(poly, {
            color,
            weight: 2.5,
            dashArray: upcoming ? '8 6' : undefined,
            fillColor: color,
            fillOpacity: upcoming ? 0.07 : 0.16,
            bubblingMouseEvents: false,
          }),
        );
      if (polys.length) badgeAt = centroid(polys.reduce((a, b) => (area(b) > area(a) ? b : a)));
    }
    if (badgeAt) {
      // Ikke la merkene ligge oppå hverandre: flytt ned til det er ledig plass.
      let pt = layerMap.latLngToContainerPoint(badgeAt);
      while (placed.some((q) => Math.abs(q.x - pt.x) < 150 && Math.abs(q.y - pt.y) < 44)) pt = pt.add([0, 46]);
      placed.push(pt);
      badgeAt = [layerMap.containerPointToLatLng(pt).lat, layerMap.containerPointToLatLng(pt).lng];
      bind(
        L.marker(badgeAt, {
          icon: L.divIcon({
            className: 'wx-pin',
            html: `<span style="background:${color}" class="${upcoming ? 'upc' : ''}">${w.kind === 'WS WRNG' ? `VINDSKJÆR ${w.fir}` : `${w.kind}${w.phenomenon ? ` ${w.phenomenon}` : ''}`}<small>${w.kind === 'WS WRNG' ? '' : `${fmt(w.lowerFt)}–${fmt(w.upperFt)} · `}til ${hhmm(w.to)}</small></span>`,
            iconSize: [150, 44],
            iconAnchor: [75, 22],
          }),
          keyboard: false,
          zIndexOffset: 450,
        }),
      );
    }
  }
}
