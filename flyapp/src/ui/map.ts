import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Airport, Navaid } from '../lib/data';
import { destination, midpoint, formatLatLon, type LatLon } from '../lib/geo';
import { CATEGORY_COLORS, categoryOf, fetchMetarsInBox, type Metar } from '../lib/metar';
import type { Waypoint } from '../lib/navlog';
import { h } from './dom';
import { airportToWaypoint, navaidToWaypoint, state, userWaypoint } from './state';
import { activeLeg, directTo } from './position';

export let map: L.Map;

const BASE_LAYERS = {
  topo: () =>
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: 'Kart: © OpenTopoMap (CC-BY-SA), data © OpenStreetMap-bidragsytere',
    }),
  osm: () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap-bidragsytere',
    }),
};

let baseLayer: L.TileLayer | null = null;
let airspaceLayer: L.TileLayer | null = null;
const airportLayer = L.layerGroup();
const navaidLayer = L.layerGroup();
const metarLayer = L.layerGroup();
const routeLayer = L.layerGroup();
const trackLayer = L.layerGroup();
const ownshipLayer = L.layerGroup();
let canvas: L.Canvas;
let metarTimer: number | undefined;
let editMode = false;

export const AIRPORT_COLORS = { towered: '#2563eb', untowered: '#c026d3' };

export function initMap(el: HTMLElement): L.Map {
  canvas = L.canvas({ padding: 0.3 });
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem('vfrapp.view') ?? 'null') as { c: [number, number]; z: number } | null;
    } catch {
      return null;
    }
  })();
  map = L.map(el, {
    zoomControl: false,
    preferCanvas: true,
    worldCopyJump: true,
  }).setView(last?.c ?? [60.5, 9.5], last?.z ?? 7);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 160 }).addTo(map);
  // Nautisk skala i tillegg.
  const NmScale = L.Control.Scale.extend({
    _updateMetric(this: { _mScale: HTMLElement; _updateScale: (s: HTMLElement, t: string, r: number) => void; _getRoundNum: (n: number) => number }, maxMeters: number) {
      const nm = maxMeters / 1852;
      const r = nm >= 1 ? this._getRoundNum(nm) : Math.round(nm * 10) / 10;
      this._updateScale(this._mScale, `${r} NM`, r / nm);
    },
  });
  new (NmScale as unknown as new (o: L.Control.ScaleOptions) => L.Control)({ position: 'bottomleft', imperial: false, maxWidth: 160 }).addTo(map);

  for (const l of [airportLayer, navaidLayer, metarLayer, routeLayer, trackLayer, ownshipLayer]) l.addTo(map);
  // METAR-sirkler under flyplassene.
  metarLayer.setZIndex?.(1);

  applySettings();
  map.on('moveend', () => {
    renderAerodata();
    scheduleMetars();
    try {
      const c = map.getCenter();
      localStorage.setItem('vfrapp.view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() }));
    } catch {
      /* ignorer */
    }
  });
  map.on('dragstart', () => {
    if (state.following) {
      state.following = false;
      state.emit('nav');
    }
  });
  map.on('click', (e: L.LeafletMouseEvent) => {
    if (editMode) addRoutePoint(userWaypoint({ lat: e.latlng.lat, lon: e.latlng.lng }));
  });
  map.on('contextmenu', (e: L.LeafletMouseEvent) => showPointMenu({ lat: e.latlng.lat, lon: e.latlng.lng }));
  // iOS sender ikke contextmenu ved langt trykk – egen deteksjon.
  let pressTimer: number | undefined;
  let pressStart: { x: number; y: number } | null = null;
  el.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1 || (ev.target as Element).closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return;
    const t = ev.touches[0];
    pressStart = { x: t.clientX, y: t.clientY };
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      if (!pressStart) return;
      const r = el.getBoundingClientRect();
      const ll = map.containerPointToLatLng([pressStart.x - r.left, pressStart.y - r.top]);
      pressStart = null;
      navigator.vibrate?.(20);
      showPointMenu({ lat: ll.lat, lon: ll.lng });
    }, 600);
  }, { passive: true });
  el.addEventListener('touchmove', (ev) => {
    const t = ev.touches[0];
    if (pressStart && Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) {
      pressStart = null;
      clearTimeout(pressTimer);
    }
  }, { passive: true });
  const cancelPress = () => {
    pressStart = null;
    clearTimeout(pressTimer);
  };
  el.addEventListener('touchend', cancelPress);
  el.addEventListener('touchcancel', cancelPress);

  state.on('settings', applySettings);
  state.on('route', renderRoute);
  state.on('position', renderOwnship);
  state.on('nav', renderRoute);
  state.on('tracks', renderTrack);
  renderRoute();
  renderAerodata();
  scheduleMetars();
  return map;
}

export function setEditMode(on: boolean): void {
  editMode = on;
  map.getContainer().classList.toggle('editing', on);
}
export const isEditMode = () => editMode;

function applySettings(): void {
  const s = state.settings;
  if (baseLayer) baseLayer.remove();
  baseLayer = BASE_LAYERS[s.baseLayer]().addTo(map);
  baseLayer.bringToBack();
  if (airspaceLayer) {
    airspaceLayer.remove();
    airspaceLayer = null;
  }
  if (s.showAirspace && s.openAipKey) {
    airspaceLayer = L.tileLayer(
      `https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(s.openAipKey)}`,
      { maxZoom: 14, minZoom: 4, opacity: 0.9, attribution: 'Luftrom © openAIP (CC BY-NC 4.0)' },
    ).addTo(map);
  }
  renderAerodata();
  if (s.showMetars) scheduleMetars();
  else metarLayer.clearLayers();
}

// ---------- Flyplasser og navaids ----------

function airportVisible(a: Airport, z: number): boolean {
  if (a.type === 'L' || a.type === 'M') return z >= 5;
  if (z >= 9) return true;
  if (z >= 7) return a.paved || a.longestFt >= 2000;
  return false;
}

export function airportPopup(a: Airport): HTMLElement {
  const rwy = a.runways
    .map((r) => `${r.le}/${r.he} ${r.lengthFt ? Math.round(r.lengthFt * 0.3048) + ' m' : ''} ${r.surface}`)
    .join(', ');
  const ctaf = a.freqs.find((f) => /TWR|AFIS|CTAF|A\/G|INFO|UNIC/i.test(f.type));
  return h(
    'div',
    { class: 'popup' },
    h('strong', null, `${a.ident} – ${a.name}`),
    h('div', { class: 'muted' }, `Høyde ${a.elevFt ?? '—'} ft${ctaf?.mhz ? ` · ${ctaf.type} ${ctaf.mhz.toFixed(3)}` : ''}`),
    rwy ? h('div', { class: 'muted small' }, rwy) : null,
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { onclick: () => (map.closePopup(), state.selectAirport(a)) }, 'Info'),
      h('button', { onclick: () => (map.closePopup(), directTo(airportToWaypoint(a))) }, 'Direkte →'),
      h('button', { onclick: () => (map.closePopup(), addRoutePoint(airportToWaypoint(a))) }, '+ Rute'),
    ),
  );
}

function navaidPopup(n: Navaid): HTMLElement {
  const freq = n.freqKhz ? (n.type.startsWith('NDB') ? `${n.freqKhz} kHz` : `${(n.freqKhz / 1000).toFixed(2)} MHz`) : '';
  return h(
    'div',
    { class: 'popup' },
    h('strong', null, `${n.ident} – ${n.name}`),
    h('div', { class: 'muted' }, `${n.type} ${freq}`),
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { onclick: () => (map.closePopup(), directTo(navaidToWaypoint(n))) }, 'Direkte →'),
      h('button', { onclick: () => (map.closePopup(), addRoutePoint(navaidToWaypoint(n))) }, '+ Rute'),
    ),
  );
}

export function renderAerodata(): void {
  if (!map || !state.db) return;
  airportLayer.clearLayers();
  navaidLayer.clearLayers();
  const z = map.getZoom();
  const b = map.getBounds().pad(0.1);
  const s = state.settings;
  if (s.showAirports) {
    const visible = state.db.airports.filter((a) => b.contains([a.lat, a.lon]) && airportVisible(a, z));
    const labels = visible.length < 120 && z >= 8;
    for (const a of visible.slice(0, 2500)) {
      const color = a.towered ? AIRPORT_COLORS.towered : AIRPORT_COLORS.untowered;
      const r = a.type === 'L' ? 7 : a.type === 'M' ? 6 : 4.5;
      const m = L.circleMarker([a.lat, a.lon], {
        renderer: canvas,
        radius: r,
        color: '#fff',
        weight: 1.5,
        fillColor: a.type === 'W' ? '#fff' : color,
        fillOpacity: 1,
      })
        .bindPopup(() => airportPopup(a))
        .addTo(airportLayer);
      if (a.type === 'W') m.setStyle({ color });
      if (labels) m.bindTooltip(a.ident, { permanent: true, direction: 'right', offset: [6, 0], className: 'ap-label' });
      // Rullebaner ved høy zoom.
      if (z >= 11)
        for (const rw of a.runways)
          if (rw.leEnd && rw.heEnd)
            L.polyline(
              [
                [rw.leEnd.lat, rw.leEnd.lon],
                [rw.heEnd.lat, rw.heEnd.lon],
              ],
              { color: '#111827', weight: z >= 13 ? 8 : 5, opacity: 0.8, interactive: false },
            ).addTo(airportLayer);
    }
  }
  if (s.showNavaids && z >= 7) {
    for (const n of state.db.navaids) {
      if (!b.contains([n.lat, n.lon])) continue;
      const isNdb = n.type.startsWith('NDB');
      L.marker([n.lat, n.lon], {
        icon: L.divIcon({
          className: 'navaid-icon',
          html: `<svg viewBox="0 0 20 20" width="18" height="18"><polygon points="5,2 15,2 19,10 15,18 5,18 1,10" fill="none" stroke="${isNdb ? '#a16207' : '#1e3a8a'}" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="${isNdb ? '#a16207' : '#1e3a8a'}"/></svg><span>${n.ident}</span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        keyboard: false,
      })
        .bindPopup(() => navaidPopup(n))
        .addTo(navaidLayer);
    }
  }
}

// ---------- METAR på kartet ----------

function scheduleMetars(): void {
  clearTimeout(metarTimer);
  if (!state.settings.showMetars) return;
  metarTimer = window.setTimeout(loadMetars, 600);
}

async function loadMetars(): Promise<void> {
  if (map.getZoom() < 6) {
    metarLayer.clearLayers();
    return;
  }
  const b = map.getBounds();
  try {
    const metars = await fetchMetarsInBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    metarLayer.clearLayers();
    for (const m of metars) drawMetar(m);
  } catch (e) {
    console.warn('METAR', e);
  }
}

function drawMetar(m: Metar): void {
  const cat = categoryOf(m);
  L.circleMarker([m.lat, m.lon], {
    renderer: canvas,
    radius: 11,
    color: CATEGORY_COLORS[cat],
    weight: 3,
    fill: false,
    opacity: 0.95,
  })
    .bindPopup(h('div', { class: 'popup' }, h('strong', null, `${m.icaoId} · ${cat}`), h('pre', { class: 'raw' }, m.rawOb)))
    .addTo(metarLayer);
}

// ---------- Rute ----------

export function addRoutePoint(w: Waypoint): void {
  state.setWaypoints([...state.route.waypoints, w]);
}

function nearestSnap(p: L.LatLng): Waypoint | null {
  if (!state.db) return null;
  const pt = map.latLngToContainerPoint(p);
  let best: { w: Waypoint; d: number } | null = null;
  const b = map.getBounds();
  for (const a of state.db.airports) {
    if (!b.contains([a.lat, a.lon]) || !airportVisible(a, map.getZoom())) continue;
    const d = pt.distanceTo(map.latLngToContainerPoint([a.lat, a.lon]));
    if (d < 18 && (!best || d < best.d)) best = { w: airportToWaypoint(a), d };
  }
  if (state.settings.showNavaids && map.getZoom() >= 7)
    for (const n of state.db.navaids) {
      if (!b.contains([n.lat, n.lon])) continue;
      const d = pt.distanceTo(map.latLngToContainerPoint([n.lat, n.lon]));
      if (d < 18 && (!best || d < best.d)) best = { w: navaidToWaypoint(n), d };
    }
  return best?.w ?? null;
}

const wpIcon = (w: Waypoint, active: boolean) =>
  L.divIcon({
    className: `wp-icon${active ? ' active' : ''}`,
    html: `<div class="wp-dot"></div><div class="wp-label">${w.id}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

function renderRoute(): void {
  if (!map) return;
  routeLayer.clearLayers();
  const wps = state.route.waypoints;
  const latlngs = wps.map((w) => [w.lat, w.lon] as [number, number]);
  if (latlngs.length > 1) {
    L.polyline(latlngs, { color: '#fff', weight: 8, opacity: 0.8, interactive: false }).addTo(routeLayer);
    L.polyline(latlngs, { color: '#d946ef', weight: 4, opacity: 1, interactive: false }).addTo(routeLayer);
  }
  const leg = activeLeg();
  if (leg && !state.directTo) {
    L.polyline(
      [
        [leg.from.lat, leg.from.lon],
        [leg.to.lat, leg.to.lon],
      ],
      { color: '#f0abfc', weight: 6, opacity: 0.9, dashArray: '1 10', lineCap: 'round', interactive: false },
    ).addTo(routeLayer);
  }
  if (state.directTo) {
    L.polyline(
      [
        [state.directTo.from.lat, state.directTo.from.lon],
        [state.directTo.to.lat, state.directTo.to.lon],
      ],
      { color: '#d946ef', weight: 4, dashArray: '10 6', interactive: false },
    ).addTo(routeLayer);
    L.marker([state.directTo.to.lat, state.directTo.to.lon], { icon: wpIcon(state.directTo.to, true), interactive: false }).addTo(routeLayer);
  }

  wps.forEach((w, i) => {
    const m = L.marker([w.lat, w.lon], {
      icon: wpIcon(w, !state.directTo && i === state.activeIndex),
      draggable: true,
      autoPan: true,
    }).addTo(routeLayer);
    m.on('dragend', () => {
      const ll = m.getLatLng();
      const snapped = nearestSnap(ll) ?? { ...w, kind: 'user', id: w.kind === 'user' ? w.id : `BRK${i}`, name: undefined, lat: ll.lat, lon: ll.lng };
      const next = [...state.route.waypoints];
      next[i] = snapped;
      state.setWaypoints(next);
    });
    m.bindPopup(() =>
      h(
        'div',
        { class: 'popup' },
        h('strong', null, `${i + 1}. ${w.id}`),
        w.name ? h('div', { class: 'muted' }, w.name) : null,
        h('div', { class: 'muted small' }, formatLatLon(w)),
        h(
          'div',
          { class: 'popup-actions' },
          h('button', { onclick: () => (map.closePopup(), directTo(w)) }, 'Direkte →'),
          h(
            'button',
            {
              onclick: () => {
                map.closePopup();
                state.setWaypoints(state.route.waypoints.filter((_, j) => j !== i));
              },
            },
            'Fjern',
          ),
        ),
      ),
    );
  });

  // Gummistrikk: dra et midtpunkt for å sette inn et nytt veipunkt.
  for (let i = 1; i < wps.length; i++) {
    const mid = midpoint(wps[i - 1], wps[i]);
    const mm = L.marker([mid.lat, mid.lon], {
      icon: L.divIcon({ className: 'mid-icon', html: '<div></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      draggable: true,
      title: 'Dra for å legge inn et veipunkt',
    }).addTo(routeLayer);
    mm.on('dragend', () => {
      const ll = mm.getLatLng();
      const w = nearestSnap(ll) ?? userWaypoint({ lat: ll.lat, lon: ll.lng });
      const next = [...state.route.waypoints];
      next.splice(i, 0, w);
      state.setWaypoints(next);
    });
  }
}

/** Utsnitt som ikke dekkes av panelet (sidepanel på stor skjerm, bunnark på mobil). */
function panelPadding(): { paddingTopLeft: L.PointExpression; paddingBottomRight: L.PointExpression } {
  const panel = document.getElementById('panel');
  const open = panel && !panel.hidden;
  const wide = window.matchMedia('(min-width: 900px)').matches;
  if (!open) return { paddingTopLeft: [70, 40], paddingBottomRight: [50, 40] };
  return wide
    ? { paddingTopLeft: [panel.offsetWidth + 70, 40], paddingBottomRight: [50, 40] }
    : { paddingTopLeft: [70, 30], paddingBottomRight: [50, panel.offsetHeight + 20] };
}

export function fitRoute(): void {
  const wps = state.route.waypoints;
  if (!wps.length) return;
  state.following = false;
  map.fitBounds(L.latLngBounds(wps.map((w) => [w.lat, w.lon])), { ...panelPadding(), maxZoom: 11 });
  state.emit('nav');
}

// ---------- Eget fly og spor ----------

let ownshipMarker: L.Marker | null = null;
let vectorLine: L.Polyline | null = null;
let breadcrumb: L.Polyline | null = null;

const planeSvg = (rot: number) =>
  `<svg viewBox="0 0 40 40" width="40" height="40" style="transform:rotate(${rot}deg)"><path d="M20 2 L23 15 L37 22 L37 25 L23 21 L22 32 L27 36 L27 38 L20 36 L13 38 L13 36 L18 32 L17 21 L3 25 L3 22 L17 15 Z" fill="#fde047" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

function renderOwnship(): void {
  const p = state.position;
  if (!p) {
    ownshipLayer.clearLayers();
    ownshipMarker = vectorLine = breadcrumb = null;
    return;
  }
  const rot = p.trkTrue ?? 0;
  if (!ownshipMarker) {
    ownshipMarker = L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'ownship', html: planeSvg(rot), iconSize: [40, 40], iconAnchor: [20, 20] }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(ownshipLayer);
  } else {
    ownshipMarker.setLatLng([p.lat, p.lon]);
    const svg = ownshipMarker.getElement()?.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${rot}deg)`;
  }
  // Fartsvektor: hvor er vi om N minutter?
  if (p.trkTrue !== null && p.gsKt && p.gsKt > 5) {
    const ahead = destination(p, p.trkTrue, (p.gsKt * state.settings.vectorMin) / 60);
    const pts: L.LatLngExpression[] = [
      [p.lat, p.lon],
      [ahead.lat, ahead.lon],
    ];
    if (!vectorLine) vectorLine = L.polyline(pts, { color: '#16a34a', weight: 3, interactive: false }).addTo(ownshipLayer);
    else vectorLine.setLatLngs(pts);
  } else if (vectorLine) {
    vectorLine.remove();
    vectorLine = null;
  }
  if (state.recording) {
    const pts = state.recording.points.map((q) => [q.lat, q.lon] as [number, number]);
    if (!breadcrumb) breadcrumb = L.polyline(pts, { color: '#0ea5e9', weight: 3, interactive: false }).addTo(ownshipLayer);
    else breadcrumb.setLatLngs(pts);
  } else if (breadcrumb) {
    breadcrumb.remove();
    breadcrumb = null;
  }
  if (state.following) map.panTo([p.lat, p.lon], { animate: true, duration: 0.5 });
}

let shownTrackId: string | null = null;
export function showTrack(id: string | null): void {
  shownTrackId = id;
  renderTrack();
  const t = state.tracks.find((x) => x.id === id);
  if (t?.points.length) map.fitBounds(L.latLngBounds(t.points.map((p) => [p.lat, p.lon])), panelPadding());
}

function renderTrack(): void {
  trackLayer.clearLayers();
  const t = state.tracks.find((x) => x.id === shownTrackId);
  if (t) L.polyline(t.points.map((p) => [p.lat, p.lon] as [number, number]), { color: '#0ea5e9', weight: 3 }).addTo(trackLayer);
}

// ---------- Kontekstmeny for et punkt ----------

function showPointMenu(p: LatLon): void {
  const w = userWaypoint(p);
  L.popup()
    .setLatLng([p.lat, p.lon])
    .setContent(
      h(
        'div',
        { class: 'popup' },
        h('strong', null, 'Punkt'),
        h('div', { class: 'muted small' }, formatLatLon(p)),
        h(
          'div',
          { class: 'popup-actions' },
          h('button', { onclick: () => (map.closePopup(), directTo(w)) }, 'Direkte →'),
          h('button', { onclick: () => (map.closePopup(), addRoutePoint(w)) }, '+ Rute'),
        ),
      ),
    )
    .openOn(map);
}

export function flyTo(p: LatLon, zoom = 10): void {
  state.following = false;
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), zoom));
  state.emit('nav');
}
