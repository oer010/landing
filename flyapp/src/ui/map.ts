import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Airport, Navaid } from '../lib/data';
import { bearingTrue, destination, distanceNm, fmtHdg, formatLatLon, type LatLon } from '../lib/geo';
import { CATEGORY_COLORS, categoryOf, fetchMetars, fetchMetarsInBox, metarAgeMin, type Metar } from '../lib/metar';
import { AIRPORT_TYPE_TEXT } from '../lib/data';
import { loadVfr, type VfrData, type VfrPoint, type VfrRoute } from '../lib/vfrdata';
import { declination, fmtVar, trueToMag } from '../lib/mag';
import { sunTimes } from '../lib/sun';
import { airspacesAt, fmtLimits, KIND_ADVICE, KIND_STYLE, KIND_TEXT, loadAirspace, type AirspaceDb, type AirspaceKind } from '../lib/airspace';
import { computeNavlog, type Waypoint } from '../lib/navlog';
import { computeProfile } from '../lib/profile';
import { perfOf } from '../lib/store';
import { badge, clear, fmt, h, toast } from './dom';
import { activeLegWinds, airportToWaypoint, navaidToWaypoint, state, userWaypoint } from './state';
import { activeLeg, directTo } from './position';
import { renameWaypoint } from './naming';
import { initNotamLayer, renderNotams } from './notamlayer';

export let map: L.Map;

// Hold boblen unna knappene til venstre (GPS/Følg/REC) og zoom-knappene nede til høyre.
const POPUP_OPTS: L.PopupOptions & { maxHeight?: number } = {
  maxWidth: 280,
  minWidth: 220,
  autoPanPaddingTopLeft: [76, 12],
  autoPanPaddingBottomRight: [12, 12],
  className: 'info-popup',
};

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
const airspaceLayer = L.layerGroup();
const vfrPointLayer = L.layerGroup();
const vfrRouteLayer = L.layerGroup();
let vfr: VfrData | null = null;
let asDb: AirspaceDb | null = null;
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
  // Større treffområde for fingre.
  canvas = L.canvas({ padding: 0.3, tolerance: 10 });
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem('vfrapp.view') ?? 'null') as { c: [number, number]; z: number } | null;
    } catch {
      return null;
    }
  })();
  map = L.map(el, {
    zoomControl: false,
    // Én felles tegneflate: med flere legger den øverste seg over og tar alle trykk.
    renderer: canvas,
    worldCopyJump: true,
  }).setView(last?.c ?? [60.5, 9.5], last?.z ?? 7);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
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

  for (const l of [airspaceLayer, vfrRouteLayer, airportLayer, navaidLayer, vfrPointLayer, metarLayer]) l.addTo(map);
  initNotamLayer(map, POPUP_OPTS);
  for (const l of [routeLayer, trackLayer, ownshipLayer]) l.addTo(map);
  loadVfr().then((d) => {
    vfr = d;
    renderVfrRoutes();
    renderAerodata();
    state.emit('airspace');
  });
  // METAR-sirkler under flyplassene.
  metarLayer.setZIndex?.(1);

  applySettings();
  // Mens en info-boble er åpen skal kartet ikke tegnes på nytt (det ville fjerne
  // flyplassen boblen hører til, og boblen lukkes). Tegn når boblen lukkes.
  let popupOpen = false;
  let pendingRender = false;
  map.on('popupopen', () => (popupOpen = true));
  map.on('popupclose', () => {
    popupOpen = false;
    if (pendingRender) {
      pendingRender = false;
      renderAerodata();
    }
  });
  map.on('moveend', () => {
    if (popupOpen) pendingRender = true;
    else renderAerodata();
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
    const p = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (editMode) addRoutePoint(nearestSnap(e.latlng) ?? userWaypoint(p));
    // Fingertrykk som bommer litt: åpne nærmeste flyplass/VOR/NDB innen ~en fingerbredde.
    else if (!openNearestAt(e.containerPoint)) showAirspacesAt(p);
  });
  map.on('zoomend', updateAirspaceLabels);
  loadAirspace().then((db) => {
    asDb = db;
    state.emit('airspace');
    renderAirspace();
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
  renderVfrRoutes();
  if (baseLayer) baseLayer.remove();
  baseLayer = BASE_LAYERS[s.baseLayer]().addTo(map);
  baseLayer.bringToBack();
  renderAirspace();
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

const SURFACE: [RegExp, string][] = [
  [/^(ASP|ASPH|BIT|TAR|PEM|MAC)/i, 'asfalt'],
  [/^(CON|CONC|PAV)/i, 'betong'],
  [/^(GRS|GRASS|TURF)/i, 'gress'],
  [/^(GRV|GRAVEL|GRE)/i, 'grus'],
  [/^(DIRT|SAND|SOIL|CLA)/i, 'jord/sand'],
  [/^(WATER|WAT)/i, 'vann'],
  [/^(SNOW|ICE)/i, 'snø/is'],
];
const surfaceText = (s: string) => SURFACE.find(([re]) => re.test(s))?.[1] ?? (s || 'ukjent dekke');

const MORSE: Record<string, string> = {
  A: '·−', B: '−···', C: '−·−·', D: '−··', E: '·', F: '··−·', G: '−−·', H: '····', I: '··', J: '·−−−', K: '−·−', L: '·−··', M: '−−',
  N: '−·', O: '−−−', P: '·−−·', Q: '−−·−', R: '·−·', S: '···', T: '−', U: '··−', V: '···−', W: '·−−', X: '−··−', Y: '−·−−', Z: '−−··',
  0: '−−−−−', 1: '·−−−−', 2: '··−−−', 3: '···−−', 4: '····−', 5: '·····', 6: '−····', 7: '−−···', 8: '−−−··', 9: '−−−−·',
};
const morse = (id: string) => id.toUpperCase().split('').map((c) => MORSE[c] ?? c).join('  ');

/** Avstand og magnetisk kurs fra egen posisjon (om kjent). */
function fromMe(p: LatLon): string | null {
  const me = state.position;
  if (!me) return null;
  const d = declination(p);
  return `${distanceNm(me, p).toFixed(1)} NM, kurs ${fmtHdg(trueToMag(bearingTrue(me, p), d))}° fra deg`;
}

/** Viktigst for VFR først. */
const FREQ_ORDER = ['TWR', 'AFIS', 'RADIO', 'A/G', 'INFO', 'CTAF', 'UNIC', 'ATIS', 'GND', 'DEL', 'APP', 'DEP'];
const sortFreqs = (fs: Airport['freqs']) =>
  [...fs].sort((x, y) => {
    const ix = FREQ_ORDER.findIndex((t) => x.type.toUpperCase().includes(t));
    const iy = FREQ_ORDER.findIndex((t) => y.type.toUpperCase().includes(t));
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });

/** Kort merknad om sektor/rullebane fra AIP (f.eks. «CTR W sector …»), ellers tom. */
const sectorNote = (desc: string) => {
  const rmk = desc.split(' – ').slice(1).join(' – ');
  return /sector|RWY|West|East|Delivery|Ground/i.test(rmk) ? rmk.slice(0, 60) : '';
};

const row = (k: string, v: Node | string) => h('tr', null, h('th', null, k), h('td', null, v));

export function airportPopup(a: Airport): HTMLElement {
  // Fast plass til METAR, så boblen ikke vokser etter at kartet har flyttet seg for å vise den.
  const hasIcao = /^[A-Z]{4}$/.test(a.ident);
  const wx = h('div', { class: 'popup-wx', style: hasIcao ? { minHeight: '92px' } : undefined }, hasIcao ? h('span', { class: 'p-muted' }, 'Henter METAR …') : null);
  if (hasIcao)
    fetchMetars([a.ident])
      .then((ms) => {
        const m = ms[0];
        if (!m) return clear(wx, h('span', { class: 'p-muted' }, 'Ingen METAR for denne flyplassen.'));
        const cat = categoryOf(m);
        clear(
          wx,
          h('div', null, badge(cat, CATEGORY_COLORS[cat]), h('span', { class: 'p-muted' }, ` ${metarAgeMin(m)} min gammel`)),
          h('div', { class: 'p-raw' }, m.rawOb),
        );
      })
      .catch(() => clear(wx, h('span', { class: 'p-muted' }, 'Vær ikke tilgjengelig nå.')));
  const sun = sunTimes(new Date(), a.lat, a.lon);
  const me = fromMe(a);
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, h('span', { class: 'p-id' }, a.ident), a.iata ? h('span', { class: 'p-muted' }, ` / ${a.iata}`) : null),
    h('div', { class: 'p-name' }, a.name),
    h('div', { class: 'p-muted' }, `${AIRPORT_TYPE_TEXT[a.type]} · ${a.towered ? 'kontrollert (TWR)' : 'ukontrollert'}${a.city ? ` · ${a.city}` : ''}`),
    h(
      'table',
      { class: 'p-table' },
      h(
        'tbody',
        null,
        row('Høyde', `${a.elevFt ?? '—'} ft${a.elevFt !== null ? ` (${Math.round(a.elevFt * 0.3048)} m)` : ''}`),
        a.runways.length
          ? row(
              'Bane',
              h(
                'div',
                null,
                a.runways.map((r) =>
                  h('div', null, h('strong', null, `${r.le}/${r.he}`), ` ${r.lengthFt ? `${Math.round(r.lengthFt * 0.3048)} m` : ''} ${surfaceText(r.surface)}${r.lighted ? ', lys' : ''}`),
                ),
              ),
            )
          : null,
        a.freqs.length
          ? row(
              'Frekv.',
              h(
                'div',
                null,
                sortFreqs(a.freqs)
                  .slice(0, 6)
                  .map((f) =>
                    h(
                      'div',
                      null,
                      h('strong', null, f.mhz?.toFixed(3) ?? '—'),
                      ` ${f.type}`,
                      f.hr && f.hr !== 'H24' ? h('span', { class: 'p-muted' }, ` ${f.hr}`) : null,
                      sectorNote(f.desc) ? h('div', { class: 'p-muted' }, sectorNote(f.desc)) : null,
                    ),
                  ),
                h(
                  'div',
                  { class: 'p-muted' },
                  a.freqSource === 'AIP' ? `Kilde: AIP Norge ${state.db.aipEdition ?? ''}` : 'Kilde: OurAirports – kan være utdatert, sjekk AIP',
                ),
              ),
            )
          : row('Frekv.', 'Ingen i databasen – sjekk AIP'),
        sun.polar === 'normal' ? row('Sol ned', `${fmt.time(sun.sunset)} (mørkt ${fmt.time(sun.civilDusk)})`) : null,
        me ? row('Fra deg', me) : null,
      ),
    ),
    wx,
    vfrChartLinks(a.ident),
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { class: 'p-primary', onclick: () => (map.closePopup(), state.selectAirport(a)) }, 'Mer info'),
      h('button', { onclick: () => (map.closePopup(), directTo(airportToWaypoint(a))) }, 'Direkte →'),
      h('button', { onclick: () => (map.closePopup(), addRoutePoint(airportToWaypoint(a))) }, '+ Rute'),
    ),
  );
}

function navaidPopup(n: Navaid): HTMLElement {
  const isNdb = n.type.startsWith('NDB');
  const freq = n.freqKhz ? (isNdb ? `${n.freqKhz} kHz` : `${(n.freqKhz / 1000).toFixed(2)} MHz`) : '—';
  const me = fromMe(n);
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, h('span', { class: 'p-id' }, n.ident), h('span', { class: 'p-muted' }, ` ${n.type}`)),
    h('div', { class: 'p-name' }, n.name),
    h(
      'table',
      { class: 'p-table' },
      h(
        'tbody',
        null,
        row('Frekvens', h('strong', null, freq)),
        row('Morse', h('span', { class: 'p-morse' }, morse(n.ident))),
        n.elevFt !== null ? row('Høyde', `${n.elevFt} ft`) : null,
        row('Misvisning', fmtVar(declination(n))),
        row('Posisjon', formatLatLon(n)),
        me ? row('Fra deg', me) : null,
      ),
    ),
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { class: 'p-primary', onclick: () => (map.closePopup(), directTo(navaidToWaypoint(n))) }, 'Direkte →'),
      h('button', { onclick: () => (map.closePopup(), addRoutePoint(navaidToWaypoint(n))) }, '+ Rute'),
    ),
  );
}

export function renderAerodata(): void {
  if (!map || !state.db) return;
  // Boblen må få plass i kartet (rulles inni om den er høyere).
  POPUP_OPTS.maxHeight = Math.max(180, map.getSize().y - 70);
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
        // Trykk på flyplassen skal ikke også åpne luftromsinfo.
        bubblingMouseEvents: false,
      })
        .bindPopup(() => airportPopup(a), POPUP_OPTS)
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
  vfrPointLayer.clearLayers();
  if (vfr && s.showVfrPoints && z >= 8) {
    for (const p of vfr.points) {
      if (!b.contains([p.lat, p.lon])) continue;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: 'vrp-icon',
          // Som på AIP-kartene: fylt ▲ = obligatorisk, åpen △ = på forespørsel.
          html: `${
            p.hold
              ? '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8" fill="rgb(255 255 255 / 0.6)" stroke="#0f172a" stroke-width="2" stroke-dasharray="3 2"/></svg>'
              : `<svg viewBox="0 0 20 18" width="18" height="16"><polygon points="10,1 19,17 1,17" fill="${p.c === 1 ? '#1d4ed8' : 'rgb(255 255 255 / 0.75)'}" stroke="#1d4ed8" stroke-width="2.2" stroke-linejoin="round"${p.c === undefined ? ' stroke-dasharray="3 2"' : ''}/></svg>`
          }${z >= 9 ? `<span${p.c === 1 ? ' class="comp"' : ''}>${p.n}${p.alt ? ` · ${fmtAlt(p.alt)}` : ''}</span>` : ''}`,
          iconSize: [30, 30],
          iconAnchor: [15, 17],
        }),
        keyboard: false,
      })
        .bindPopup(() => vfrPointPopup(p), POPUP_OPTS)
        .addTo(vfrPointLayer);
    }
  }
  if (s.showNavaids && z >= 7) {
    for (const n of state.db.navaids) {
      if (!b.contains([n.lat, n.lon])) continue;
      const isNdb = n.type.startsWith('NDB');
      L.marker([n.lat, n.lon], {
        icon: L.divIcon({
          className: 'navaid-icon',
          // 32×32 treffområde rundt et 22 px symbol; trykk som bommer fanges av kartets nærmeste-søk.
          html: `<svg viewBox="0 0 20 20" width="22" height="22"><polygon points="5,2 15,2 19,10 15,18 5,18 1,10" fill="rgb(255 255 255 / 0.6)" stroke="${isNdb ? '#a16207' : '#1e3a8a'}" stroke-width="2.2"/><circle cx="10" cy="10" r="2.2" fill="${isNdb ? '#a16207' : '#1e3a8a'}"/></svg><span>${n.ident}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
        keyboard: false,
      })
        .bindPopup(() => navaidPopup(n), POPUP_OPTS)
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
    const metars = await fetchMetarsInBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), () =>
      state.db.airports
        .filter((a) => a.country === 'NO' && /^EN[A-Z]{2}$/.test(a.ident) && a.type !== 'S' && b.contains([a.lat, a.lon]))
        .map((a) => a.ident),
    );
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
    // Ringen skal ikke ta trykket – flyplassens boble viser METAR.
    interactive: false,
  }).addTo(metarLayer);
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
  // VFR-rapporteringspunkter og venteområder, når laget vises.
  if (vfr && state.settings.showVfrPoints && map.getZoom() >= 8)
    for (const v of vfr.points) {
      if (!b.contains([v.lat, v.lon])) continue;
      const d = pt.distanceTo(map.latLngToContainerPoint([v.lat, v.lon]));
      // Litt foran flyplasser/navaids ved lik avstand – de ligger ofte tett.
      if (d < 20 && (!best || d < best.d - 2)) best = { w: vfrPointToWaypoint(v), d };
    }
  return best?.w ?? null;
}

/** VFR-rapporteringspunkt som rutepunkt (beholder AIP-navnet). */
export function vfrPointToWaypoint(v: VfrPoint): Waypoint {
  const kind = v.hold ? 'venteområde' : v.c === 1 ? 'obligatorisk VFR-punkt' : 'VFR-punkt';
  return { id: v.n, name: `${kind} ${v.ad.join('/')}`, kind: 'user', lat: v.lat, lon: v.lon, manualName: true, needsName: false };
}

const wpIcon = (w: Waypoint, active: boolean, fresh = false) =>
  L.divIcon({
    className: `wp-icon${active ? ' active' : ''}${fresh ? ' fresh' : ''}`,
    html: `<div class="wp-dot"></div><div class="wp-label">${w.id}</div>`,
    // 40 px gripeområde for fingeren rundt et 20 px punkt.
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

function renderRoute(): void {
  if (!map) return;
  routeLayer.clearLayers();
  const wps = state.route.waypoints;
  const latlngs = wps.map((w) => [w.lat, w.lon] as [number, number]);
  if (latlngs.length > 1) {
    L.polyline(latlngs, { color: '#fff', weight: 8, opacity: 0.8, interactive: false }).addTo(routeLayer);
    L.polyline(latlngs, { color: '#d946ef', weight: 4, opacity: 1, interactive: false }).addTo(routeLayer);
    // Usynlig, bred treffsone langs ruten: dobbelttrykk legger inn et punkt der.
    const hit = L.polyline(latlngs, { color: '#000', opacity: 0, weight: 24, interactive: true, bubblingMouseEvents: false }).addTo(routeLayer);
    hit.on('click', (e: L.LeafletMouseEvent) => onRouteLineTap(e.containerPoint, e.latlng));
    // Ekte dblclick (PC/mus): ikke zoom, legg inn punkt.
    hit.on('dblclick', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      lastLineTap = null;
      map.closePopup();
      insertRoutePointAt(e.latlng);
    });
  }
  // TOC/TOD-merker langs ruten.
  if (wps.length > 1) {
    const r = state.route;
    const ac = state.currentAircraft;
    const legs = computeNavlog(wps, { tas: ac.tas, wind: { dir: r.windDir, speed: r.windSpeed }, legWinds: activeLegWinds(r), fuelBurn: ac.fuelBurn, altitudeFt: r.altitudeFt });
    for (const row of computeProfile(wps, legs, perfOf(ac)).rows) {
      const tag = row.kind === 'climb' ? 'TOC' : row.kind === 'cruise' && row.label === 'TOD' ? 'TOD' : row.kind === 'descent' && row.legIndex < legs.length - 1 ? '↘' : null;
      if (!tag) continue;
      L.marker([row.end.lat, row.end.lon], {
        icon: L.divIcon({ className: 'vp-icon', html: `<span>${tag}</span>`, iconSize: [10, 10], iconAnchor: [5, 5] }),
        interactive: false,
        keyboard: false,
      }).addTo(routeLayer);
    }
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
      icon: wpIcon(w, !state.directTo && i === state.activeIndex, i === justInserted),
      draggable: true,
      autoPan: true,
    }).addTo(routeLayer);
    m.on('dragend', () => {
      const ll = m.getLatLng();
      // Flyttet fritt: nytt stedsnavn automatisk, med mindre brukeren har navngitt punktet.
      const snapped =
        nearestSnap(ll) ??
        ({ ...w, kind: 'user', id: w.kind === 'user' ? w.id : `BRK${i}`, name: w.manualName ? w.name : undefined, lat: ll.lat, lon: ll.lng, needsName: !w.manualName } as Waypoint);
      const next = [...state.route.waypoints];
      next[i] = { ...snapped, legAltFt: w.legAltFt ?? null };
      state.setWaypoints(next);
    });
    m.bindPopup(() =>
      h(
        'div',
        { class: 'popup' },
        h('div', { class: 'p-title' }, `${i + 1}. ${w.id}`),
        w.name ? h('div', { class: 'muted' }, w.name) : null,
        h('div', { class: 'muted small' }, formatLatLon(w)),
        w.kind === 'user' ? renameBox(i, w) : null,
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

  // Nye punkter: dobbelttrykk på rutestreken (se treffsonen over).
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
        h('div', { class: 'p-title' }, 'Punkt'),
        h('div', { class: 'muted small' }, formatLatLon(p)),
        asDb ? airspaceList(airspacesAt(asDb, p)) : null,
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

// ---------- Luftrom ----------

/** Synlig og relevant for VFR: nedre grense under 10 000 ft. */
const airspaceRelevant = (a: AirspaceDb['airspaces'][number]) => a.lo < 10000 && a.kind !== 'OTHER';
const LABEL_MIN_ZOOM: Partial<Record<AirspaceKind, number>> = { CTR: 8, TIZ: 8, RMZ: 9, ATZ: 9, R: 10, P: 10, TMA: 10, D: 11, SPORT: 11 };

function renderAirspace(): void {
  if (!map) return;
  airspaceLayer.clearLayers();
  if (asDb && state.settings.showAirspace) {
    // Store/høye områder først, så små soner (CTR) havner øverst.
    const list = asDb.airspaces.filter(airspaceRelevant).sort((x, y) => {
      const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
      return area(y.bbox) - area(x.bbox);
    });
    for (const a of list) {
      const st = KIND_STYLE[a.kind];
      const poly = L.polygon(
        a.g.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])),
        { ...st, fillColor: st.color, interactive: false, smoothFactor: 1 },
      ).addTo(airspaceLayer);
      const minZ = LABEL_MIN_ZOOM[a.kind];
      if (minZ !== undefined)
        poly.bindTooltip(`<b>${esc(a.n)}</b><br>${a.c.length === 1 ? `${a.c} · ` : ''}${fmtLimits(a)}`, {
          permanent: true,
          direction: 'center',
          // CTR/TIZ ligger rundt flyplassen: flytt etiketten ned så den ikke dekker flyplassen.
          offset: a.kind === 'CTR' || a.kind === 'TIZ' ? [0, 30] : [0, 0],
          className: `as-label as-z${minZ}`,
          opacity: 1,
        });
    }
  }
  updateAirspaceLabels();
  // Tegn flyplasser, rute og vær over luftrommet igjen (felles tegneflate tegner i rekkefølge).
  renderNotams();
  renderAerodata();
  renderRoute();
  scheduleMetars();
}

function updateAirspaceLabels(): void {
  const c = map.getContainer();
  const z = map.getZoom();
  for (const lvl of [8, 9, 10, 11]) c.classList.toggle(`show-as${lvl}`, z >= lvl);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);

export function airspaceList(list: AirspaceDb['airspaces']): HTMLElement {
  if (!list.length) return h('div', { class: 'p-muted', style: { marginTop: '6px' } }, 'Ingen kontrollert/spesielt luftrom her (klasse G).');
  return h(
    'div',
    { class: 'as-list' },
    list.map((a) =>
      h(
        'div',
        { class: 'as-item', style: { borderLeftColor: KIND_STYLE[a.kind].color } },
        h('div', null, h('strong', null, a.n), a.c.length === 1 ? h('span', { class: 'as-class' }, a.c) : null),
        h('div', { class: 'as-limits' }, fmtLimits(a)),
        h('div', { class: 'p-muted' }, KIND_TEXT[a.kind]),
        a.f ? h('div', null, 'Frekvens ', h('strong', null, a.f.replace(/\s*MHZ/i, ' MHz'))) : null,
        a.notam || a.amc ? h('div', { class: 'as-flag' }, a.notam ? 'Aktiveres ved NOTAM' : 'Aktiveres av AMC – sjekk status') : null,
        h('div', { class: 'p-muted' }, KIND_ADVICE[a.kind]),
      ),
    ),
  );
}

function showAirspacesAt(p: LatLon): void {
  if (!asDb || !state.settings.showAirspace) return;
  const list = airspacesAt(asDb, p).filter(airspaceRelevant);
  if (!list.length) return;
  L.popup(POPUP_OPTS)
    .setLatLng([p.lat, p.lon])
    .setContent(
      h(
        'div',
        { class: 'popup' },
        h('div', { class: 'p-title' }, 'Luftrom her'),
        h('div', { class: 'p-muted' }, `Lavest først · AIRAC ${asDb.airac}`),
        airspaceList(list),
        h(
          'div',
          { class: 'popup-actions' },
          h('button', { onclick: () => (map.closePopup(), directTo(userWaypoint(p))) }, 'Direkte →'),
          h('button', { onclick: () => (map.closePopup(), addRoutePoint(userWaypoint(p))) }, '+ Rute'),
        ),
      ),
    )
    .openOn(map);
}

export const getAirspaceDb = () => asDb;
export const getVfr = () => vfr;

/** Lenker til offisielle VFR-/innflygingskart (PDF i AIP) for en flyplass. */
export function vfrChartLinks(ident: string): HTMLElement | null {
  const list = vfr?.charts[ident];
  if (!list?.length) return null;
  const n = vfr!.points.filter((p) => p.ad.includes(ident)).length;
  return h(
    'div',
    { class: 'p-charts' },
    h('div', { class: 'p-muted' }, `VFR: ${n} rapporteringspunkter${vfr!.routes.some((o) => o.ad === ident) ? ` · ${vfr!.routes.filter((o) => o.ad === ident).length} VFR-ruter på kartet` : ''}`),
    list.map((c) => h('a', { href: c.url, target: '_blank', rel: 'noopener', class: 'p-chartlink' }, `📄 ${c.title}`)),
  );
}

/** Nærmeste VFR-punkt (inkl. venteområder) til en posisjon, innen 3 km. */
function nearestVfrPoint(lat: number, lon: number, ad: string): VfrPoint | null {
  let best: { d: number; p: VfrPoint } | null = null;
  for (const p of vfr?.points ?? []) {
    if (!p.ad.includes(ad)) continue;
    const d = distanceNm({ lat, lon }, p);
    if (d < 1.7 && (!best || d < best.d)) best = { d, p };
  }
  return best?.p ?? null;
}

const fmtAlt = (a?: { max?: number; min?: number } | null) =>
  a ? [a.min ? `MIN ${a.min} ft` : '', a.max ? `MAX ${a.max} ft` : ''].filter(Boolean).join(' · ') : '';

function renderVfrRoutes(): void {
  vfrRouteLayer.clearLayers();
  if (!vfr || !state.settings.showVfrCharts) return;
  for (const r of vfr.routes) {
    const ll = r.pts.map(([a, b]) => [a, b] as [number, number]);
    // Linjene på AIP-kartet stopper ved pilspissen like før punktet – la dem gå helt inn til punktet.
    const a0 = nearestVfrPoint(ll[0][0], ll[0][1], r.ad);
    const a1 = nearestVfrPoint(ll[ll.length - 1][0], ll[ll.length - 1][1], r.ad);
    if (a0) ll[0] = [a0.lat, a0.lon];
    if (a1) ll[ll.length - 1] = [a1.lat, a1.lon];
    L.polyline(ll, { color: '#fff', weight: 6, opacity: 0.85, interactive: false }).addTo(vfrRouteLayer);
    L.polyline(ll, { color: '#0f172a', weight: 2.6, opacity: 0.95, interactive: false }).addTo(vfrRouteLayer);
    // Bred, usynlig treffsone for fingeren.
    L.polyline(ll, { color: '#000', opacity: 0, weight: 22, bubblingMouseEvents: false })
      .bindPopup(() => vfrRoutePopup(r), POPUP_OPTS)
      .addTo(vfrRouteLayer);
    // Pilspisser i endene som på AIP-kartet.
    const arrow = (end: [number, number], from: [number, number]) => {
      const brg = bearingTrue({ lat: from[0], lon: from[1] }, { lat: end[0], lon: end[1] });
      // Pilspissen litt før punktet, så den ikke dekker trekanten.
      const back = destination({ lat: end[0], lon: end[1] }, (brg + 180) % 360, 0.35);
      const tip: [number, number] = [back.lat, back.lon];
      L.marker(tip, {
        icon: L.divIcon({ className: 'vfr-arrow', html: `<svg viewBox="0 0 12 12" width="12" height="12" style="transform:rotate(${brg}deg)"><polygon points="6,0 11,11 6,8 1,11" fill="#0f172a" stroke="#fff" stroke-width="1"/></svg>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
        interactive: false,
        keyboard: false,
      }).addTo(vfrRouteLayer);
    };
    if (r.arrowEnd && ll.length > 1) arrow(ll[ll.length - 1], ll[Math.max(0, ll.length - 3)]);
    if (r.arrowStart && ll.length > 1) arrow(ll[0], ll[Math.min(ll.length - 1, 2)]);
  }
}

function vfrRoutePopup(r: VfrRoute): HTMLElement {
  const a = nearestVfrPoint(r.pts[0][0], r.pts[0][1], r.ad);
  const b = nearestVfrPoint(r.pts[r.pts.length - 1][0], r.pts[r.pts.length - 1][1], r.ad);
  const nm = (p: VfrPoint | null) => p?.n ?? 'punkt';
  const dir = r.arrowStart && r.arrowEnd ? '⇄' : r.arrowEnd ? '→' : r.arrowStart ? '←' : '–';
  const endAlts = [a, b].filter((p): p is VfrPoint => !!p?.alt).map((p) => `${p.n}: ${fmtAlt(p.alt)}`);
  const toWp = vfrPointToWaypoint;
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, `${nm(a)} ${dir} ${nm(b)}`),
    h('div', { class: 'p-kind' }, `VFR-rute · ${r.ad} ${state.db.byIdent.get(r.ad)?.name ?? ''}`),
    h(
      'table',
      { class: 'p-table' },
      h(
        'tbody',
        null,
        row('Høyde', h('strong', null, fmtAlt(r.alt) || 'Ikke angitt ved linjen')),
        endAlts.length ? row('Ved punktene', endAlts.join(' · ')) : null,
        r.note ? row('Merknad', r.note) : null,
        row('Lengde', `${distanceNm({ lat: r.pts[0][0], lon: r.pts[0][1] }, { lat: r.pts[r.pts.length - 1][0], lon: r.pts[r.pts.length - 1][1] }).toFixed(1)} NM`),
        row('Kilde', `AIP Norge ${vfr?.edition ?? ''}, ${r.chart} (±${r.accuracyM} m). Sjekk alltid kartet.`),
      ),
    ),
    a && b
      ? h(
          'div',
          { class: 'popup-actions' },
          h('button', { class: 'p-primary', onclick: () => (map.closePopup(), state.setWaypoints([...state.route.waypoints, toWp(a), toWp(b)])) }, '+ Legg ruten i min rute'),
        )
      : null,
  );
}

function vfrPointPopup(p: VfrPoint): HTMLElement {
  const w = vfrPointToWaypoint(p);
  const me = fromMe(p);
  return h(
    'div',
    { class: 'popup' },
    h('div', { class: 'p-title' }, p.n),
    h(
      'div',
      { class: `p-kind ${p.c === 1 ? 'comp' : ''}` },
      p.hold ? '◯ Venteområde (holding)' : p.c === 1 ? '▲ Obligatorisk rapporteringspunkt' : p.c === 0 ? '△ Rapporteringspunkt på forespørsel' : 'Rapporteringspunkt (type ukjent – sjekk kartet)',
    ),
    h(
      'div',
      { class: 'p-muted' },
      p.ad
        .map((a) => {
          const t = p.cad?.[a];
          const mark = p.ad.length > 1 && t !== undefined ? (t === 1 ? '▲ ' : '△ ') : '';
          return `${mark}${a} ${state.db.byIdent.get(a)?.name ?? ''}`.trim();
        })
        .join(' · '),
    ),
    h(
      'table',
      { class: 'p-table' },
      h(
        'tbody',
        null,
        p.alt ? row('Høyde', h('strong', null, fmtAlt(p.alt))) : null,
        row('Posisjon', formatLatLon(p)),
        me ? row('Fra deg', me) : null,
        row(
          'Kilde',
          p.src === 'chart'
            ? `Avlest fra symbolet på AIP-kartet (±${p.acc ?? 100} m) – står ikke i kartets koordinattabell`
            : `AIP Norge ${vfr?.edition ?? ''}, koordinattabell på VFR-/innflygingskartet`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { class: 'p-primary', onclick: () => (map.closePopup(), directTo(w)) }, 'Direkte →'),
      h('button', { onclick: () => (map.closePopup(), addRoutePoint(w)) }, '+ Rute'),
    ),
  );
}

/** Felt for å gi et brukerpunkt eget navn, eller hente stedsnavn automatisk. */
function renameBox(i: number, w: Waypoint): HTMLElement {
  const input = h('input', { type: 'text', class: 'p-input', value: w.manualName ? w.id : '', placeholder: w.autoName ? `${w.id} (auto)` : 'Navn på punktet', maxlength: 20 });
  const save = () => {
    map.closePopup();
    renameWaypoint(i, input.value);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  return h(
    'div',
    { class: 'p-rename' },
    input,
    h(
      'div',
      { class: 'popup-actions' },
      h('button', { class: 'p-primary', onclick: save }, 'Lagre navn'),
      h('button', { onclick: () => (map.closePopup(), renameWaypoint(i, '')) }, 'Finn stedsnavn'),
    ),
  );
}

/**
 * Trykk på rutestreken. iPhone-Safari sender ikke alltid dblclick til siden, så vi
 * gjenkjenner dobbelttrykk selv (to trykk innen 450 ms og 30 px). Et enkelt trykk
 * åpner en boble med knappen «Legg inn punkt her».
 */
let lastLineTap: { t: number; pt: L.Point } | null = null;
let linePopupTimer: number | undefined;
let lastInsertAt = 0;
function onRouteLineTap(pt: L.Point, ll: L.LatLng): void {
  // Trykk i enden av ruten (på en flyplass/VOR) skal fortsatt gi info om den.
  if (nearWaypoint(pt)) {
    lastLineTap = null;
    openNearestAt(pt);
    return;
  }
  const now = Date.now();
  if (lastLineTap && now - lastLineTap.t < 450 && lastLineTap.pt.distanceTo(pt) < 30) {
    // Andre trykk: dobbelttrykk.
    clearTimeout(linePopupTimer);
    lastLineTap = null;
    map.closePopup();
    insertRoutePointAt(ll);
    return;
  }
  lastLineTap = { t: now, pt };
  // Vent litt med boblen, så et raskt andre trykk blir et dobbelttrykk (boblen kan flytte kartet).
  clearTimeout(linePopupTimer);
  linePopupTimer = window.setTimeout(() => showLinePopup(ll), 330);
}

function showLinePopup(ll: L.LatLng): void {
  L.popup({ ...POPUP_OPTS, minWidth: 200, className: 'info-popup line-popup' })
    .setLatLng(ll)
    .setContent(
      h(
        'div',
        { class: 'popup' },
        h('div', { class: 'p-name' }, 'Rutestreken'),
        h(
          'div',
          { class: 'popup-actions' },
          h(
            'button',
            {
              class: 'p-primary',
              onclick: () => {
                map.closePopup();
                insertRoutePointAt(ll);
              },
            },
            '＋ Legg inn punkt her',
          ),
        ),
        h('div', { class: 'p-muted' }, 'Dra punktet dit ruten skal gå. Tips: dobbelttrykk på streken gjør det samme.'),
      ),
    )
    .openOn(map);
}

/** Er trykket nær et eksisterende veipunkt (piksler)? */
function nearWaypoint(pt: L.Point, px = 18): boolean {
  return state.route.waypoints.some((w) => pt.distanceTo(map.latLngToContainerPoint([w.lat, w.lon])) <= px);
}

/** Legger inn et brukerpunkt på det legget som er nærmest trykket, akkurat på streken. */
function insertRoutePointAt(ll0: L.LatLng): void {
  // Både vår dobbelttrykk-gjenkjenning og nettleserens dblclick kan slå til – bare én gang.
  if (Date.now() - lastInsertAt < 700) return;
  lastInsertAt = Date.now();
  clearTimeout(linePopupTimer);
  // Regn fra kartposisjon (kartet kan ha flyttet seg siden trykket, f.eks. for å vise en boble).
  const pt = map.latLngToContainerPoint(ll0);
  const wps = state.route.waypoints;
  if (wps.length < 2 || nearWaypoint(pt)) return;
  let best = { i: 1, d: Infinity, p: pt };
  for (let i = 1; i < wps.length; i++) {
    const a = map.latLngToContainerPoint([wps[i - 1].lat, wps[i - 1].lon]);
    const b = map.latLngToContainerPoint([wps[i].lat, wps[i].lon]);
    const ab = b.subtract(a);
    const len2 = ab.x * ab.x + ab.y * ab.y || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * ab.x + (pt.y - a.y) * ab.y) / len2));
    const p = L.point(a.x + ab.x * t, a.y + ab.y * t);
    const d = p.distanceTo(pt);
    if (d < best.d) best = { i, d, p };
  }
  const ll = map.containerPointToLatLng(best.p);
  const next = [...wps];
  // Det nye punktet arver høyden til legget som deles.
  next.splice(best.i, 0, { ...userWaypoint({ lat: ll.lat, lon: ll.lng }), legAltFt: wps[best.i].legAltFt ?? null });
  justInserted = best.i;
  state.setWaypoints(next);
  navigator.vibrate?.(15);
  toast('Punkt lagt inn – dra det dit ruten skal gå');
  window.setTimeout(() => {
    justInserted = -1;
    renderRoute();
  }, 4000);
}
let justInserted = -1;

const TAP_RADIUS_PX = 26;

/** Åpner info for nærmeste synlige flyplass eller navaid nær trykket. Returnerer true om noe ble åpnet. */
function openNearestAt(pt: L.Point): boolean {
  if (!state.db) return false;
  const z = map.getZoom();
  const b = map.getBounds();
  let best: { d: number; ll: [number, number]; content: () => HTMLElement } | null = null;
  const consider = (lat: number, lon: number, content: () => HTMLElement) => {
    if (!b.contains([lat, lon])) return;
    const d = pt.distanceTo(map.latLngToContainerPoint([lat, lon]));
    if (d <= TAP_RADIUS_PX && (!best || d < best.d)) best = { d, ll: [lat, lon], content };
  };
  if (state.settings.showNavaids && z >= 7) for (const n of state.db.navaids) consider(n.lat, n.lon, () => navaidPopup(n));
  if (vfr && state.settings.showVfrPoints && z >= 8) for (const p of vfr.points) consider(p.lat, p.lon, () => vfrPointPopup(p));
  if (state.settings.showAirports) for (const a of state.db.airports) if (airportVisible(a, z)) consider(a.lat, a.lon, () => airportPopup(a));
  const hit = best as { d: number; ll: [number, number]; content: () => HTMLElement } | null;
  if (!hit) return false;
  L.popup(POPUP_OPTS).setLatLng(hit.ll).setContent(hit.content()).openOn(map);
  return true;
}

export function flyTo(p: LatLon, zoom = 10): void {
  state.following = false;
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), zoom));
  state.emit('nav');
}
