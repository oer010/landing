// NOTAM som markeringer i kartet: områder (polygon/sirkel) der NOTAM-en gjelder,
// hinderpunkter, og et merke ved flyplasser med NOTAM som bare gjelder flyplassen.

import L from 'leaflet';
import { fmtNotamTime, loadNotams, notamDrawable, notamKind, notamShapes, notamStatus, type Notam, type NotamData, type NotamKind } from '../lib/notam';
import { h } from './dom';
import { state } from './state';

const KIND: Record<NotamKind, { color: string; text: string }> = {
  restriction: { color: '#dc2626', text: 'Restriksjon / fareområde' },
  obstacle: { color: '#ea580c', text: 'Hinder' },
  aerodrome: { color: '#7c3aed', text: 'Flyplass' },
  navaid: { color: '#0891b2', text: 'Navigasjonshjelpemiddel' },
  airspace: { color: '#d97706', text: 'Luftrom / ATS' },
  other: { color: '#d97706', text: 'Annet' },
};

/** Bare det som er aktuelt for VFR: under FL125, aktiv nå eller innen et døgn. */
const VFR_CEILING_FT = 12500;

let data: NotamData | null = null;
let layer: L.LayerGroup;
let map: L.Map;
let popupOpts: L.PopupOptions;

export function notamData(): NotamData | null {
  return data;
}

export function relevantNotams(now = new Date()): Notam[] {
  if (!data) return [];
  return data.notams.filter((n) => {
    const s = notamStatus(n, now);
    return (s === 'active' || s === 'upcoming') && n.lowerFt < VFR_CEILING_FT && notamDrawable(n);
  });
}

/** Relevante NOTAM som ikke kan plasseres i kartet (store områder uten avgrensning). */
export function unplacedNotams(): Notam[] {
  return relevantNotams().filter((n) => !notamShapes(n).length && n.qLat === undefined && !(n.locs.length === 1 && /^EN[A-Z]{2}$/.test(n.locs[0]) && !['ENOR', 'ENOB'].includes(n.locs[0])));
}

/** Relevante NOTAM for én flyplass (A-feltet). */
export function notamsForAirport(ident: string): Notam[] {
  return relevantNotams().filter((n) => n.locs.includes(ident));
}

export function initNotamLayer(m: L.Map, opts: L.PopupOptions): void {
  map = m;
  popupOpts = opts;
  layer = L.layerGroup().addTo(map);
  const refresh = (force = false) =>
    loadNotams(force).then((d) => {
      if (d) data = d;
      renderNotams();
      state.emit('notam');
    });
  void refresh();
  // Hent nytt hvert 15. minutt og når appen åpnes igjen.
  setInterval(() => void refresh(true), 15 * 60e3);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
  state.on('settings', renderNotams);
  map.on('zoomend', renderNotams);
}

export function renderNotams(): void {
  if (!layer) return;
  layer.clearLayers();
  if (!state.settings.showNotams || !data) return;
  const now = new Date();
  const byAd = new Map<string, Notam[]>();
  const pins = new Map<string, { pos: [number, number]; list: Notam[] }>();
  for (const n of relevantNotams(now)) {
    const kind = notamKind(n);
    const shapes = notamShapes(n);
    const upcoming = notamStatus(n, now) === 'upcoming';
    const ad = n.locs.length === 1 && /^EN[A-Z]{2}$/.test(n.locs[0]) && n.locs[0] !== 'ENOR' && n.locs[0] !== 'ENOB' ? n.locs[0] : null;
    // Flyplass-NOTAM uten egen geometri (bane stengt, ATIS u/s …) samles i et merke ved flyplassen.
    if (ad && (n.geoms.length === 0 || /^\s*A\s*$/.test(n.scope))) {
      byAd.set(ad, [...(byAd.get(ad) ?? []), n]);
      continue;
    }
    const { color } = KIND[kind];
    const style: L.PathOptions = {
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: upcoming ? 0.06 : 0.14,
      opacity: upcoming ? 0.6 : 0.9,
      dashArray: upcoming ? '6 5' : undefined,
      bubblingMouseEvents: false,
    };
    const open = () => notamPopup([n]);
    const opts = { ...popupOpts, maxHeight: 360 } as L.PopupOptions;
    let anchor: [number, number] | null = null;
    for (const g of shapes) {
      let l: L.Layer;
      if (g.type === 'polygon') {
        l = L.polygon(g.pts, style);
        anchor ??= centroid(g.pts);
      } else if (g.type === 'circle') {
        l = L.circle([g.lat, g.lon], { ...style, radius: g.rNm * 1852 });
        anchor ??= [g.lat, g.lon];
      } else {
        l = L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            className: 'notam-pt',
            html: `<svg viewBox="0 0 20 20" width="20" height="20"><polygon points="10,1 19,18 1,18" fill="${color}" stroke="#fff" stroke-width="1.5"/><text x="10" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">!</text></svg>`,
            iconSize: [36, 36],
            iconAnchor: [18, 20],
          }),
          keyboard: false,
        });
      }
      l.bindPopup(open, opts).addTo(layer);
    }
    // Store områder uten avgrensning: tynn stiplet ring fra Q-linjen + merke i midten.
    if (!shapes.length && n.qLat !== undefined && n.qLon !== undefined) {
      if (n.qRadiusNm !== undefined && n.qRadiusNm < 999)
        L.circle([n.qLat, n.qLon], { color, weight: 1.2, opacity: 0.55, dashArray: '4 6', fill: false, interactive: false, radius: n.qRadiusNm * 1852 }).addTo(layer);
      anchor = [n.qLat, n.qLon];
    }
    // Merke med type og trykkflate for hver NOTAM utenfor flyplassene (punkter har eget symbol).
    if (anchor && shapes.every((g) => g.type !== 'point')) {
      const k = `${anchor[0].toFixed(2)},${anchor[1].toFixed(2)}`;
      const g = pins.get(k) ?? { pos: anchor, list: [] as Notam[] };
      g.list.push(n);
      pins.set(k, g);
    }
  }
  // Merker: NOTAM utenfor flyplassene og flyplass-NOTAM. Merker som ligger tett på skjermen
  // slås sammen til ett (med antall), så kartet ikke blir fullt når man zoomer ut.
  type Item = { pos: [number, number]; list: Notam[]; ad?: string };
  const items: Item[] = [...pins.values()];
  for (const [ad, list] of byAd) {
    const a = state.db.byIdent.get(ad);
    const lat = a?.lat ?? list[0].qLat;
    const lon = a?.lon ?? list[0].qLon;
    if (lat !== undefined && lon !== undefined) items.push({ pos: [lat, lon], list, ad });
  }
  const R = 72;
  const clusters: { pt: L.Point; items: Item[] }[] = [];
  for (const it of items) {
    const pt = map.latLngToLayerPoint(it.pos);
    const c = clusters.find((c) => c.pt.distanceTo(pt) < R);
    if (c) c.items.push(it);
    else clusters.push({ pt, items: [it] });
  }
  for (const c of clusters) {
    const list = c.items.flatMap((i) => i.list);
    const one = c.items.length === 1 ? c.items[0] : null;
    const active = list.some((n) => notamStatus(n, now) === 'active');
    // Farge: restriksjon først, ellers flyplass (lilla) eller typen.
    const kinds = list.map(notamKind);
    const color = kinds.includes('restriction') ? KIND.restriction.color : one?.ad ? KIND.aerodrome.color : KIND[kinds[0]].color;
    const label = one?.ad ? `NOTAM ${list.length}` : `⚠ NOTAM${list.length > 1 ? ` ${list.length}` : ''}`;
    const pos = one ? one.pos : map.layerPointToLatLng(c.pt);
    const title = one?.ad ? `${one.ad} ${state.db.byIdent.get(one.ad)?.name ?? ''}` : c.items.length > 1 ? `${list.length} NOTAM i området` : undefined;
    L.marker(pos, {
      icon: L.divIcon({
        className: one?.ad ? 'notam-ad' : 'notam-pin',
        html: `<span class="${active ? '' : 'upc'}" style="background:${color}">${label}</span>`,
        iconSize: one?.ad ? [70, 40] : [86, 38],
        // Flyplassmerket over og til høyre for flyplass-symbolet.
        iconAnchor: one?.ad ? [-2, 44] : [43, 19],
      }),
      keyboard: false,
      zIndexOffset: one?.ad ? 500 : 400,
    })
      .bindPopup(() => notamPopup(list, title), { ...popupOpts, maxHeight: 380 } as L.PopupOptions)
      .addTo(layer);
  }
}

function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length;
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
}

function fmtLimit(text: string | undefined, ft: number, lower: boolean): string {
  if (text) return text;
  if (lower && ft === 0) return 'GND';
  if (ft >= 99900) return 'UNL';
  return ft >= 10000 || ft % 100 === 0 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${ft} ft`;
}

export function notamPopup(list: Notam[], title?: string): HTMLElement {
  const now = new Date();
  const sorted = [...list].sort((a, b) => (a.from?.getTime() ?? 0) - (b.from?.getTime() ?? 0));
  return h(
    'div',
    { class: 'popup notam-popup' },
    title ? h('div', { class: 'p-title' }, `NOTAM ${title}`) : null,
    sorted.map((n) => {
      const st = notamStatus(n, now);
      return h(
        'div',
        { class: 'notam-item' },
        h(
          'div',
          { class: 'p-kind' },
          h('span', { class: 'notam-dot', style: `background:${KIND[notamKind(n)].color}` }),
          ` ${n.id} · ${KIND[notamKind(n)].text} · `,
          h('strong', { class: st === 'active' ? 'notam-on' : 'notam-upc' }, st === 'active' ? 'AKTIV' : 'KOMMENDE'),
        ),
        h('div', { class: 'muted small' }, `${fmtNotamTime(n.from)} – ${n.perm ? 'PERM' : fmtNotamTime(n.to)}${n.est ? ' EST' : ''}${n.schedule ? ` · ${n.schedule}` : ''}`),
        h('div', { class: 'muted small' }, `${n.lowerFt === 0 && n.upperFt >= 99900 && !n.upperText ? '' : `${fmtLimit(n.lowerText, n.lowerFt, true)} – ${fmtLimit(n.upperText, n.upperFt, false)} · `}${n.locs.join(' ')}`),
        h('div', { class: 'notam-text' }, n.text),
      );
    }),
    data && Date.now() - new Date(data.generated).getTime() > 2 * 3600e3
      ? h('div', { class: 'warnbox small' }, `NOTAM-dataene er ${Math.round((Date.now() - new Date(data.generated).getTime()) / 3600e3)} timer gamle – nye NOTAM kan mangle. Sjekk ippc.no.`)
      : null,
    h('div', { class: 'muted small' }, `Hentet ${data ? new Date(data.generated).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : '–'} fra FAA NOTAM Search. Ikke offisiell briefing – sjekk alltid IPPC/AIS.`),
  );
}
