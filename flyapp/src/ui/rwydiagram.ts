// Lite banekart: banene i riktig retning og innbyrdes plassering (nord opp), med vindpil.

import type { Airport } from '../lib/data';
import { runwayEnds } from '../lib/runway';

const NS = 'http://www.w3.org/2000/svg';

export function runwayDiagram(a: Airport, decl: number, wind: { dir: number; speed: number } | null): SVGSVGElement | null {
  const rws = a.runways.map((r) => ({ r, ends: runwayEnds(r, decl) })).filter((x) => x.ends[0].trueHdg !== null);
  if (!rws.length) return null;
  const S = 220;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
  svg.setAttribute('class', 'rwy-diagram');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  // Plassering i meter rundt flyplassens referansepunkt.
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const pts = rws.map(({ r, ends }) => {
    const lenM = (r.lengthFt ?? 3000) * 0.3048;
    if (r.leEnd && r.heEnd)
      return { a: [(r.leEnd.lon - a.lon) * kx, (r.leEnd.lat - a.lat) * 111320], b: [(r.heEnd.lon - a.lon) * kx, (r.heEnd.lat - a.lat) * 111320], ends, r };
    const t = ((ends[0].trueHdg ?? 0) * Math.PI) / 180;
    const dx = (Math.sin(t) * lenM) / 2;
    const dy = (Math.cos(t) * lenM) / 2;
    return { a: [-dx, -dy], b: [dx, dy], ends, r };
  });
  // Sentrer på banene (flyplassens referansepunkt ligger ofte ved siden av).
  const xs = pts.flatMap((p) => [p.a[0], p.b[0]]);
  const ys = pts.flatMap((p) => [p.a[1], p.b[1]]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of pts) {
    p.a = [p.a[0] - cx, p.a[1] - cy];
    p.b = [p.b[0] - cx, p.b[1] - cy];
  }
  const ext = Math.max(...pts.flatMap((p) => [Math.abs(p.a[0]), Math.abs(p.a[1]), Math.abs(p.b[0]), Math.abs(p.b[1])]), 300);
  const sc = (S / 2 - 38) / ext;
  const X = (m: number) => S / 2 + m * sc;
  const Y = (m: number) => S / 2 - m * sc;
  add('circle', { cx: S / 2, cy: S / 2, r: S / 2 - 4, class: 'rose' });
  add('text', { x: S / 2, y: 14, class: 'north', 'text-anchor': 'middle' }, 'N');
  for (const p of pts) {
    add('line', { x1: X(p.a[0]), y1: Y(p.a[1]), x2: X(p.b[0]), y2: Y(p.b[1]), class: 'rwy', 'stroke-width': Math.max(5, Math.min(10, ((p.r.widthFt ?? 100) / 100) * 6)) });
    // Banenumre utenfor endene (le-enden er der le-banen starter).
    const lab = (pt: number[], other: number[], txt: string) => {
      const dx = pt[0] - other[0];
      const dy = pt[1] - other[1];
      const L = Math.hypot(dx, dy) || 1;
      add('text', { x: X(pt[0]) + (dx / L) * 16, y: Y(pt[1]) - (dy / L) * 16 + 4, class: 'rwy-lbl', 'text-anchor': 'middle' }, txt);
    };
    lab(p.a, p.b, p.ends[0].ident);
    lab(p.b, p.a, p.ends[1].ident);
  }
  if (wind && wind.speed > 0) {
    // Pil som peker dit vinden blåser, fra kanten vinden kommer fra (vind i METAR er rettvisende).
    const t = (wind.dir * Math.PI) / 180;
    const r0 = S / 2 - 10;
    const x0 = S / 2 + Math.sin(t) * r0;
    const y0 = S / 2 - Math.cos(t) * r0;
    const x1 = S / 2 + Math.sin(t) * (r0 - 46);
    const y1 = S / 2 - Math.cos(t) * (r0 - 46);
    add('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'wind' });
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const hx = (d: number, s: number) => x1 - Math.cos(ang + s) * d;
    const hy = (d: number, s: number) => y1 - Math.sin(ang + s) * d;
    add('polygon', { points: `${x1},${y1} ${hx(10, 0.5)},${hy(10, 0.5)} ${hx(10, -0.5)},${hy(10, -0.5)}`, class: 'wind-head' });
    add('text', { x: x0 + (x0 < S / 2 ? 4 : -4), y: y0 + (y0 < S / 2 ? 14 : -6), class: 'wind-lbl', 'text-anchor': x0 < S / 2 ? 'start' : 'end' }, `${wind.speed} kt`);
  }
  return svg;
}
