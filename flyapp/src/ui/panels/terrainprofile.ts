// Høydeprofil langs ruten: terreng (Kartverket), planlagt høyde og hindre.

import { distanceNm, type LatLon } from '../../lib/geo';
import { topFt } from '../../lib/obstacles';
import type { Profile } from '../../lib/profile';
import { routeTerrain, type TerrainSample } from '../../lib/terrain';
import { h, section } from '../dom';
import { obstacleData } from '../obstaclelayer';
import { state } from '../state';

const SVGNS = 'http://www.w3.org/2000/svg';
let cached: { key: string; samples: TerrainSample[] | null; error?: string; loading?: Promise<void> } | null = null;

const routeKey = (wps: LatLon[]) => wps.map((w) => `${w.lat.toFixed(4)},${w.lon.toFixed(4)}`).join(';');

/** Planlagt høyde (ft) ved distanse d fra profilradene. */
export function plannedAltAt(prof: Profile, d: number): number | null {
  for (const r of prof.rows) {
    const start = r.cumDist - r.dist;
    if (d <= r.cumDist + 1e-6) {
      const f = r.dist > 0 ? Math.max(0, Math.min(1, (d - start) / r.dist)) : 1;
      return r.altFrom + (r.altTo - r.altFrom) * f;
    }
  }
  return prof.rows.length ? prof.rows[prof.rows.length - 1].altTo : null;
}

export function terrainSection(wps: LatLon[], prof: Profile): HTMLElement {
  const body = h('div', null);
  const key = routeKey(wps);
  if (!cached || cached.key !== key) {
    cached = { key, samples: null };
    const c = cached;
    c.loading = routeTerrain(wps)
      .then((s) => {
        c.samples = s;
      })
      .catch((e: Error) => {
        c.error = navigator.onLine ? e.message : 'Uten nett – terrengprofilen hentes når du er på nett igjen.';
      })
      .finally(() => {
        c.loading = undefined;
        if (cached === c) state.emit('route');
      });
  }
  if (cached.loading) body.append(h('p', { class: 'muted small' }, 'Henter terrenghøyder fra Kartverket …'));
  else if (cached.error) body.append(h('p', { class: 'warnbox' }, cached.error));
  else if (cached.samples) body.append(...draw(wps, prof, cached.samples));
  return section('Høydeprofil og terreng', body);
}

function draw(wps: LatLon[], prof: Profile, samples: TerrainSample[]): Node[] {
  const total = samples[samples.length - 1]?.d ?? 0;
  // Hindre innenfor 1 NM fra ruten.
  const obst: { d: number; top: number }[] = [];
  const od = obstacleData();
  if (od)
    for (const o of od.obstacles) {
      const t = topFt(o);
      if (t === null) continue;
      let best: { d: number; dist: number } | null = null;
      for (const s of samples) {
        if (Math.abs(s.pos.lat - o.lat) > 0.03) continue;
        const dist = distanceNm(s.pos, o);
        if (dist <= 1 && (!best || dist < best.dist)) best = { d: s.d, dist };
      }
      if (best) obst.push({ d: best.d, top: t });
    }
  // Minste klaring og høyeste punkt.
  let minClr: { d: number; clr: number; terr: number } | null = null;
  let maxT: { d: number; ft: number } | null = null;
  for (const s of samples) {
    if (s.ft === null) continue;
    if (!maxT || s.ft > maxT.ft) maxT = { d: s.d, ft: s.ft };
    const alt = plannedAltAt(prof, s.d);
    // Ikke regn klaring nær avgang/landing (første/siste 2 NM).
    if (alt === null || s.d < 2 || s.d > total - 2) continue;
    const clr = alt - s.ft;
    if (!minClr || clr < minClr.clr) minClr = { d: s.d, clr, terr: s.ft };
  }
  for (const o of obst) {
    const alt = plannedAltAt(prof, o.d);
    if (alt === null || o.d < 2 || o.d > total - 2) continue;
    if (!minClr || alt - o.top < minClr.clr) minClr = { d: o.d, clr: alt - o.top, terr: o.top };
  }

  const W = 600;
  const H = 210;
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const maxAlt = Math.max(...prof.rows.map((r) => Math.max(r.altFrom, r.altTo)), maxT?.ft ?? 0, ...obst.map((o) => o.top)) * 1.12 + 200;
  const x = (d: number) => pad.l + (d / Math.max(total, 0.1)) * (W - pad.l - pad.r);
  const y = (ft: number) => H - pad.b - (ft / maxAlt) * (H - pad.t - pad.b);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'terrain-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
    return el;
  };
  // Rutenett hver 1000/2000 ft.
  const stepFt = maxAlt > 8000 ? 2000 : 1000;
  for (let f = stepFt; f < maxAlt; f += stepFt) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(f), y2: y(f), class: 'grid' });
    add('text', { x: pad.l - 4, y: y(f) + 4, class: 'axis', 'text-anchor': 'end' }, `${f}`);
  }
  // Terreng (fylt).
  const pts = samples.map((s) => `${x(s.d).toFixed(1)},${y(s.ft ?? 0).toFixed(1)}`);
  add('polygon', { points: `${x(0)},${y(0)} ${pts.join(' ')} ${x(total)},${y(0)}`, class: 'terr' });
  // Klaring < 500 ft rødt, < 1000 ft gult.
  for (const s of samples) {
    const alt = plannedAltAt(prof, s.d);
    if (s.ft === null || alt === null || s.d < 2 || s.d > total - 2) continue;
    const clr = alt - s.ft;
    if (clr < 1000) add('line', { x1: x(s.d), x2: x(s.d), y1: y(s.ft), y2: y(alt), class: clr < 500 ? 'clr-bad' : 'clr-warn' });
  }
  // Hindre.
  for (const o of obst) add('line', { x1: x(o.d), x2: x(o.d), y1: y(0), y2: y(o.top), class: 'obst' });
  // Planlagt høyde.
  const alts: string[] = [];
  for (let d = 0; d <= total; d += total / 200) {
    const a = plannedAltAt(prof, d);
    if (a !== null) alts.push(`${x(d).toFixed(1)},${y(a).toFixed(1)}`);
  }
  add('polyline', { points: alts.join(' '), class: 'plan' });
  // Veipunkter.
  let cum = 0;
  wps.forEach((w, i) => {
    if (i > 0) cum += distanceNm(wps[i - 1], w);
    add('line', { x1: x(cum), x2: x(cum), y1: pad.t, y2: H - pad.b, class: 'wpline' });
    add('text', { x: x(cum), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === wps.length - 1 ? 'end' : 'middle' }, (w as { id?: string }).id ?? '');
  });
  add('text', { x: 4, y: pad.t + 4, class: 'axis' }, 'ft');

  const msg = minClr
    ? minClr.clr < 500
      ? h('p', { class: 'warnbox' }, `For lavt: bare ${Math.round(minClr.clr)} ft over terreng/hinder (${Math.round(minClr.terr)} ft) ved ${minClr.d.toFixed(0)} NM. Øk høyden på legget.`)
      : h('p', { class: minClr.clr < 1000 ? 'warnbox' : 'muted small' }, `Minste klaring ${Math.round(minClr.clr)} ft (terreng/hinder ${Math.round(minClr.terr)} ft ved ${minClr.d.toFixed(0)} NM).`)
    : null;
  return [
    svg,
    msg ?? h('span'),
    h(
      'p',
      { class: 'muted small' },
      `Høyeste terreng innen 1 NM fra ruten: ${maxT ? `${Math.round(maxT.ft)} ft ved ${maxT.d.toFixed(0)} NM` : '–'}. Brun = terreng (Kartverket), lilla = planlagt høyde, røde streker = hindre, rødt/gult = under 500/1000 ft klaring. Husk SERA-minstehøyder (500 ft, 1000 ft over tettbebyggelse).`,
    ),
  ];
}
