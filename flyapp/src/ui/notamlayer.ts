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
  return relevantNotams().filter((n) => !notamShapes(n).length && !(n.locs.length === 1 && /^EN[A-Z]{2}$/.test(n.locs[0]) && !['ENOR', 'ENOB'].includes(n.locs[0])));
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
}

export function renderNotams(): void {
  if (!layer) return;
  layer.clearLayers();
  if (!state.settings.showNotams || !data) return;
  const now = new Date();
  const byAd = new Map<string, Notam[]>();
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
    for (const g of shapes) {
      let l: L.Layer;
      if (g.type === 'polygon') l = L.polygon(g.pts, style);
      else if (g.type === 'circle') l = L.circle([g.lat, g.lon], { ...style, radius: g.rNm * 1852 });
      else
        l = L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            className: 'notam-pt',
            html: `<svg viewBox="0 0 20 20" width="20" height="20"><polygon points="10,1 19,18 1,18" fill="${color}" stroke="#fff" stroke-width="1.5"/><text x="10" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">!</text></svg>`,
            iconSize: [20, 20],
            iconAnchor: [10, 12],
          }),
          keyboard: false,
        });
      l.bindPopup(() => notamPopup([n]), { ...popupOpts, maxHeight: 360 } as L.PopupOptions).addTo(layer);
    }
  }
  for (const [ad, list] of byAd) {
    const a = state.db.byIdent.get(ad);
    const lat = a?.lat ?? list[0].qLat;
    const lon = a?.lon ?? list[0].qLon;
    if (lat === undefined || lon === undefined) continue;
    const active = list.some((n) => notamStatus(n, now) === 'active');
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'notam-ad',
        html: `<span class="${active ? '' : 'upc'}">N${list.length}</span>`,
        iconSize: [30, 18],
        // Over og til høyre for flyplass-symbolet, så det ikke dekker det.
        iconAnchor: [-6, 24],
      }),
      keyboard: false,
      zIndexOffset: 500,
    })
      .bindPopup(() => notamPopup(list, `${ad} ${a?.name ?? ''}`), { ...popupOpts, maxHeight: 360 } as L.PopupOptions)
      .addTo(layer);
  }
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
    h('div', { class: 'muted small' }, `Hentet ${data ? new Date(data.generated).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : '–'} fra FAA NOTAM Search. Ikke offisiell briefing – sjekk alltid IPPC/AIS.`),
  );
}
