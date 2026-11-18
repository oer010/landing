// Luftfartshindre i kartet.

import L from 'leaflet';
import { loadObstacles, OBSTACLE_TEXT, topFt, type Obstacle, type ObstacleData } from '../lib/obstacles';
import { h } from './dom';
import { state } from './state';

let data: ObstacleData | null = null;
let layer: L.LayerGroup;
let map: L.Map;
let popupOpts: L.PopupOptions;

export const obstacleData = () => data;

export function initObstacleLayer(m: L.Map, opts: L.PopupOptions): void {
  map = m;
  popupOpts = opts;
  layer = L.layerGroup().addTo(map);
  void loadObstacles().then((d) => {
    data = d;
    renderObstacles();
    state.emit('obstacles');
  });
  map.on('moveend', renderObstacles);
  state.on('settings', renderObstacles);
}

const ft = (m: number) => Math.round(m * 3.28084);

export function renderObstacles(): void {
  if (!layer) return;
  layer.clearLayers();
  if (!data || !state.settings.showObstacles) return;
  const z = map.getZoom();
  if (z < 9) return;
  const b = map.getBounds().pad(0.1);
  // Ved oversiktszoom bare de høyeste.
  const minH = z >= 11 ? 0 : z === 10 ? 45 : 90;
  let n = 0;
  for (const o of data.obstacles) {
    if (o.heightM < minH || !b.contains([o.lat, o.lon])) continue;
    if (++n > 1500) break;
    const color = o.heightM >= 100 ? '#dc2626' : '#ea580c';
    const marker =
      z >= 11
        ? L.marker([o.lat, o.lon], {
            icon: L.divIcon({
              className: 'obst-icon',
              html: `<svg viewBox="0 0 14 18" width="14" height="18"><path d="M7 1 L12.5 17 M7 1 L1.5 17 M3.4 11 H10.6" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${o.lit ? `<circle cx="7" cy="2.5" r="2.3" fill="#facc15" stroke="${color}" stroke-width="1"/>` : ''}</svg><span>${ft(o.heightM)}</span>`,
              iconSize: [14, 18],
              iconAnchor: [7, 17],
            }),
            keyboard: false,
          })
        : L.circleMarker([o.lat, o.lon], { radius: 3.5, color: '#fff', weight: 1, fillColor: color, fillOpacity: 1 });
    marker.bindPopup(() => obstaclePopup(o), popupOpts).addTo(layer);
  }
}

function obstaclePopup(o: Obstacle): HTMLElement {
  const top = topFt(o);
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, `${OBSTACLE_TEXT[o.type]} ${ft(o.heightM)} ft`),
    h('div', { class: 'p-kind' }, `Luftfartshinder${o.lit ? ' · merket med lys' : ' · lys ikke registrert'}`),
    h(
      'table',
      { class: 'p-table' },
      h(
        'tbody',
        null,
        h('tr', null, h('th', null, 'Høyde'), h('td', null, `${ft(o.heightM)} ft (${o.heightM} m) over bakken`)),
        h('tr', null, h('th', null, 'Topp'), h('td', null, top !== null ? `${top} ft over havet` : 'terrenghøyde ikke registrert')),
        h('tr', null, h('th', null, 'Kilde'), h('td', null, `OpenStreetMap / Kartverket NRL (hentet ${data ? new Date(data.generated).toLocaleDateString('nb-NO') : '–'}). Ikke komplett – kraftlinjer og luftspenn er ikke med.`)),
      ),
    ),
  );
}
