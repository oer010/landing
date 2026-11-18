// Vær-fanen: radarbilder, områdevarsel (IGA) og SIGMET/AIRMET fra MET Norge.

import { activeWarnings, areaForecasts, fetchWarnings, RADAR_AREAS, radarFrames, type AreaForecast, type MetWarning, type RadarFrame } from '../../lib/metwx';
import { load, save } from '../../lib/store';
import { h, section } from '../dom';

let radarArea = load<string>('radarArea', 'norway');
let timer: number | undefined;

export function radarSection(): HTMLElement {
  const img = h('img', { class: 'radar-img', alt: 'Radarbilde fra MET Norge' }) as HTMLImageElement;
  const label = h('div', { class: 'muted small' }, 'Henter radar …');
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, class: 'grow' }) as HTMLInputElement;
  const play = h('button', null, '▶');
  let frames: RadarFrame[] = [];
  const show = (i: number) => {
    const f = frames[i];
    if (!f) return;
    img.src = f.url;
    slider.value = String(i);
    const age = Math.round((Date.now() - new Date(f.time).getTime()) / 60000);
    label.textContent = `${new Date(f.time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })} lokal tid (${age} min siden) · reflektivitet (dBZ)`;
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    play.textContent = '▶';
  };
  play.onclick = () => {
    if (timer) return stop();
    play.textContent = '❚❚';
    // Siste 12 bilder (1 time) i løkke.
    let i = Math.max(0, frames.length - 12);
    timer = window.setInterval(() => {
      show(i);
      i = i >= frames.length - 1 ? Math.max(0, frames.length - 12) : i + 1;
    }, 600);
  };
  slider.oninput = () => (stop(), show(+slider.value));
  const loadArea = () => {
    stop();
    label.textContent = 'Henter radar …';
    radarFrames(radarArea)
      .then((f) => {
        frames = f;
        slider.max = String(Math.max(0, f.length - 1));
        show(f.length - 1);
      })
      .catch((e: Error) => (label.textContent = navigator.onLine ? e.message : 'Radar krever nett.'));
  };
  const select = h(
    'select',
    {
      onchange: (e: Event) => {
        radarArea = (e.target as HTMLSelectElement).value;
        save('radarArea', radarArea);
        loadArea();
      },
    },
    Object.entries(RADAR_AREAS).map(([k, v]) => h('option', { value: k, selected: k === radarArea }, v)),
  );
  loadArea();
  return section('Radar (MET Norge)', h('div', { class: 'row' }, select, play, slider), img, label);
}

let igaCache: { at: number; p: Promise<AreaForecast[]> } | null = null;
let wrnCache: { at: number; p: Promise<MetWarning[]> } | null = null;

export function getWarnings(): Promise<MetWarning[]> {
  if (!wrnCache || Date.now() - wrnCache.at > 5 * 60e3) wrnCache = { at: Date.now(), p: fetchWarnings() };
  return wrnCache.p;
}

export function areaForecastSection(): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted small' }, 'Henter områdevarsel …'));
  if (!igaCache || Date.now() - igaCache.at > 10 * 60e3) igaCache = { at: Date.now(), p: areaForecasts() };
  igaCache.p
    .then((list) =>
      body.replaceChildren(
        ...list.map((f, i) =>
          h(
            'details',
            { class: 'iga', open: i === 0 },
            h('summary', null, `${f.header} · ${f.title}`),
            h('pre', { class: 'wx-text' }, f.text),
          ),
        ),
        h('p', { class: 'muted small' }, 'IGA = områdevarsel for lav flyging (erstatter LLF). Vind og 0-isoterm: se GAF-kartet på ippc.no.'),
      ),
    )
    .catch((e: Error) => body.replaceChildren(h('p', { class: 'warnbox' }, navigator.onLine ? e.message : 'Områdevarsel krever nett.')));
  return section('Områdevarsel (IGA)', body);
}

export function warningsSection(): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted small' }, 'Henter SIGMET/AIRMET …'));
  getWarnings()
    .then((all) => {
      const list = activeWarnings(all);
      body.replaceChildren(
        list.length
          ? h(
              'div',
              null,
              list.map((w) =>
                h(
                  'div',
                  { class: `wrn wrn-${w.kind === 'SIGMET' ? 'sig' : w.kind === 'AIRMET' ? 'air' : 'ws'}` },
                  h('strong', null, `${w.kind} ${w.id} ${w.fir}`),
                  h('div', { class: 'muted small' }, `Gyldig ${w.from ? w.from.toISOString().slice(11, 16) : '?'}–${w.to ? w.to.toISOString().slice(11, 16) : '?'}Z${w.polygons.length ? ' · vises i kartet' : ''}`),
                  h('pre', { class: 'wx-text' }, w.text),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'Ingen gjeldende SIGMET, AIRMET eller vindskjærvarsler.'),
      );
    })
    .catch((e: Error) => body.replaceChildren(h('p', { class: 'warnbox' }, navigator.onLine ? e.message : 'SIGMET krever nett.')));
  return section('SIGMET / AIRMET', body);
}
