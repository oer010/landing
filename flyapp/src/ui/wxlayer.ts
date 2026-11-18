// SIGMET/AIRMET-områder i kartet.

import L from 'leaflet';
import { activeWarnings, type MetWarning } from '../lib/metwx';
import { h } from './dom';
import { getWarnings } from './panels/metwx';
import { state } from './state';

let layer: L.LayerGroup;
let list: MetWarning[] = [];

export function initWxLayer(map: L.Map, popupOpts: L.PopupOptions): void {
  layer = L.layerGroup().addTo(map);
  const refresh = () =>
    getWarnings()
      .then((w) => {
        list = activeWarnings(w);
        render(popupOpts);
      })
      .catch(() => undefined);
  void refresh();
  setInterval(refresh, 10 * 60e3);
  state.on('settings', () => render(popupOpts));
}

const fmt = (ft: number | null) => (ft === null ? '?' : ft === 0 ? 'SFC' : ft >= 10000 || ft % 1000 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : `${ft} ft`);

function render(popupOpts: L.PopupOptions): void {
  layer.clearLayers();
  if (!state.settings.showSigmet) return;
  for (const w of list)
    for (const poly of w.polygons) {
      const sig = w.kind === 'SIGMET';
      L.polygon(poly, { color: sig ? '#be123c' : '#7c3aed', weight: 2, dashArray: '8 5', fillOpacity: 0.08, bubblingMouseEvents: false })
        .bindPopup(
          () =>
            h(
              'div',
              { class: 'popup' },
              h('div', { class: 'p-title' }, `${w.kind} ${w.id}`),
              h('div', { class: 'p-kind' }, `${fmt(w.lowerFt)} – ${fmt(w.upperFt)} · til ${w.to ? w.to.toISOString().slice(11, 16) : '?'}Z`),
              h('pre', { class: 'wx-text' }, w.text),
            ),
          popupOpts,
        )
        .addTo(layer);
    }
}
