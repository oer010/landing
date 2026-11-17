import { bearingTrue, crossTrackNm, distanceNm, fmtHdg } from '../lib/geo';
import { declination, trueToMag } from '../lib/mag';
import { fmtMin } from '../lib/navlog';
import { h, clear } from './dom';
import { activeLeg } from './position';
import { state } from './state';

const CELLS = ['GS', 'TRK', 'ALT', 'NESTE', 'DIS', 'BRG', 'ETE', 'ETA', 'XTK', 'DEST'] as const;
type Cell = (typeof CELLS)[number];

export function initDatabar(el: HTMLElement): void {
  const values = new Map<Cell, HTMLElement>();
  clear(
    el,
    CELLS.map((c) => {
      const v = h('span', { class: 'v' }, '—');
      values.set(c, v);
      return h('div', { class: `cell cell-${c.toLowerCase()}` }, h('span', { class: 'k' }, c), v);
    }),
  );

  const render = () => {
    const p = state.position;
    const set = (c: Cell, text: string, warn = false) => {
      const e = values.get(c)!;
      e.textContent = text;
      e.classList.toggle('warn', warn);
    };
    const decl = p ? declination(p) : 0;
    set('GS', p?.gsKt != null ? `${Math.round(p.gsKt)} kt` : '—');
    set('TRK', p?.trkTrue != null ? `${fmtHdg(trueToMag(p.trkTrue, decl))}°` : '—');
    set('ALT', p?.altFt != null ? `${Math.round(p.altFt / 10) * 10} ft` : '—');
    const leg = activeLeg();
    set('NESTE', leg ? leg.to.id : '—');
    if (!p || !leg) {
      for (const c of ['DIS', 'BRG', 'ETE', 'ETA', 'XTK', 'DEST'] as Cell[]) set(c, '—');
      return;
    }
    const dist = distanceNm(p, leg.to);
    const gs = p.gsKt ?? 0;
    set('DIS', `${dist.toFixed(dist < 10 ? 1 : 0)} NM`);
    set('BRG', `${fmtHdg(trueToMag(bearingTrue(p, leg.to), decl))}°`);
    const ete = gs > 20 ? (dist / gs) * 60 : null;
    set('ETE', fmtMin(ete));
    set('ETA', ete !== null ? new Date(Date.now() + ete * 60000).toISOString().slice(11, 16) + 'Z' : '—');
    const xtk = crossTrackNm(leg.from, leg.to, p);
    set('XTK', `${Math.abs(xtk).toFixed(1)}${xtk > 0.05 ? 'R' : xtk < -0.05 ? 'L' : ''}`, Math.abs(xtk) > 2);
    // Gjenstående til destinasjon langs ruten.
    const wps = state.route.waypoints;
    let rem = dist;
    if (!state.directTo) for (let i = state.activeIndex; i < wps.length - 1; i++) rem += distanceNm(wps[i], wps[i + 1]);
    set('DEST', gs > 20 ? `${Math.round(rem)} NM ${fmtMin((rem / gs) * 60)}` : `${Math.round(rem)} NM`);
  };
  state.on('nav', render);
  state.on('position', render);
  render();
}
