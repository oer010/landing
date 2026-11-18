// Start- og landingsdistanse for DA 40 NG (AFM-tabeller) mot banen som er valgt.

import type { Airport } from '../../lib/data';
import { landingDistance, pressureAltitude, takeoffDistance, type PerfInput, type PerfResult } from '../../lib/da40perf';
import { fmt, h, section } from '../dom';
import { state } from '../state';

type Phase = 'to' | 'ldg';
const inp: Record<Phase, { icao: string; rwy: string; qnh: number; oat: number; windDir: number; windKt: number; wet: boolean; grass: PerfInput['surface'] }> = {
  to: { icao: '', rwy: '', qnh: 1013, oat: 15, windDir: 0, windKt: 0, wet: false, grass: 'grass-short' },
  ldg: { icao: '', rwy: '', qnh: 1013, oat: 15, windDir: 0, windKt: 0, wet: false, grass: 'grass-short' },
};

interface RwyDir {
  id: string;
  hdgTrue: number | null;
  lengthM: number | null;
  paved: boolean;
}

function rwyDirs(a: Airport | undefined): RwyDir[] {
  if (!a) return [];
  const out: RwyDir[] = [];
  for (const r of a.runways) {
    const paved = /ASP|CON|PEM|BIT|PAV|TAR|MAC/i.test(r.surface);
    const len = r.lengthFt ? Math.round(r.lengthFt * 0.3048) : null;
    const h1 = r.leHeadingTrue;
    if (r.le) out.push({ id: r.le, hdgTrue: h1, lengthM: len, paved });
    if (r.he) out.push({ id: r.he, hdgTrue: h1 === null ? null : (h1 + 180) % 360, lengthM: len, paved });
  }
  return out;
}

/** Bane-retning fra navnet («19L» → 190°) når kursen mangler. */
const hdgOf = (r: RwyDir) => r.hdgTrue ?? (/^\d{2}/.test(r.id) ? +r.id.slice(0, 2) * 10 : 0);

export function takeoffSection(takeoffKg: number, landingKg: number): HTMLElement {
  const wps = state.route.waypoints;
  if (!inp.to.icao && wps[0]?.kind === 'airport') inp.to.icao = wps[0].id;
  if (!inp.ldg.icao && wps.length > 1 && wps[wps.length - 1].kind === 'airport') inp.ldg.icao = wps[wps.length - 1].id;
  return section(
    'Start- og landingsdistanse (AFM)',
    h('p', { class: 'muted small' }, 'DA 40 NG, AFM 5.3.7 og 5.3.12: klaff T/O ved start og LDG ved landing, tørr, flat asfalt som grunnlag, med AFM-korreksjoner for vind, gress, våt bane og helning. Masse fra M&B over.'),
    phaseBox('to', 'Avgang', takeoffKg),
    phaseBox('ldg', 'Landing', landingKg),
  );
}

function phaseBox(ph: Phase, title: string, massKg: number): HTMLElement {
  const v = inp[ph];
  const out = h('div', { class: 'perf-out' });
  const ap = () => state.db.byIdent.get(v.icao.toUpperCase());
  const rwySel = h('select', null) as HTMLSelectElement;
  const fillRwys = () => {
    const dirs = rwyDirs(ap());
    if (!dirs.some((d) => d.id === v.rwy)) {
      // Velg banen med mest motvind.
      const best = [...dirs].sort((a, b) => Math.cos(((v.windDir - hdgOf(b)) * Math.PI) / 180) - Math.cos(((v.windDir - hdgOf(a)) * Math.PI) / 180))[0];
      v.rwy = best?.id ?? '';
    }
    rwySel.replaceChildren(...dirs.map((d) => h('option', { value: d.id, selected: d.id === v.rwy }, `${d.id}${d.lengthM ? ` · ${d.lengthM} m` : ''}${d.paved ? '' : ' · gress/grus'}`)));
  };
  const calc = () => {
    const a = ap();
    const dir = rwyDirs(a).find((d) => d.id === v.rwy);
    if (!a || !dir) {
      out.replaceChildren(h('p', { class: 'muted small' }, a ? 'Ingen baner registrert.' : 'Skriv inn ICAO-kode.'));
      return;
    }
    const pa = pressureAltitude(a.elevFt ?? 0, v.qnh);
    const angle = ((v.windDir - hdgOf(dir)) * Math.PI) / 180;
    // Vinden er oppgitt som magnetisk i ATIS/METAR – banen fra OurAirports er rettvisende.
    // For norske plasser er forskjellen liten (2–10°); vi bruker oppgitt retning direkte.
    const head = v.windKt * Math.cos(angle);
    const cross = Math.abs(v.windKt * Math.sin(angle));
    const surface: PerfInput['surface'] = dir.paved ? 'paved' : v.grass;
    const pin: PerfInput = { massKg, pressureAltFt: pa, oatC: v.oat, headwindKt: head, surface, wet: v.wet, slopePct: 0 };
    const r: PerfResult = ph === 'to' ? takeoffDistance(pin) : landingDistance(pin);
    const avail = dir.lengthM;
    const need = r.over50ftM;
    const margin = avail && !r.outsideTable ? avail / need : null;
    out.replaceChildren(
      h(
        'table',
        { class: 'mini' },
        h(
          'tbody',
          null,
          h('tr', null, h('td', null, 'Trykkhøyde / masse'), h('td', null, `${pa} ft · ${Math.round(massKg)} kg`)),
          h('tr', null, h('td', null, 'Vindkomponent'), h('td', null, `${head >= 0 ? 'motvind' : 'medvind'} ${Math.abs(Math.round(head))} kt · sidevind ${Math.round(cross)} kt${cross > 25 ? ' (over demonstrert 25 kt!)' : ''}`)),
          h('tr', null, h('td', null, 'Rulledistanse'), h('td', null, r.outsideTable ? '–' : `${r.groundRollM} m`)),
          h('tr', { class: margin === null ? '' : margin < 1 ? 'bad' : margin < 1.3 ? 'warn' : 'good' }, h('td', null, ph === 'to' ? 'Til 50 ft' : 'Fra 50 ft'), h('td', null, r.outsideTable ? '–' : `${r.over50ftM} m`)),
          h('tr', null, h('td', null, 'Banelengde'), h('td', null, avail ? `${avail} m${margin ? ` (${fmt.n(margin, 2)}× behov)` : ''}` : 'ukjent')),
        ),
      ),
      r.notes.length ? h('p', { class: 'muted small' }, r.notes.join(' · ')) : h('span'),
      margin !== null && margin < 1.3
        ? h('p', { class: 'warnbox' }, margin < 1 ? 'Banen er for kort for beregnet distanse!' : 'Under 30 % margin – vurder nøye (anbefalt sikkerhetsfaktor 1,3).')
        : h('span'),
    );
  };
  const num = (label: string, key: 'qnh' | 'oat' | 'windDir' | 'windKt', unit: string) =>
    h(
      'label',
      { class: 'field' },
      h('span', null, label),
      h(
        'div',
        { class: 'row' },
        h('input', {
          type: 'number',
          inputmode: 'numeric',
          value: v[key],
          oninput: (e: Event) => {
            v[key] = +(e.target as HTMLInputElement).value || 0;
            if (key === 'windDir') fillRwys();
            calc();
          },
        }),
        h('span', { class: 'unit' }, unit),
      ),
    );
  rwySel.onchange = () => {
    v.rwy = rwySel.value;
    calc();
  };
  fillRwys();
  calc();
  return h(
    'div',
    { class: 'perf-box' },
    h('h4', null, title),
    h(
      'div',
      { class: 'grid2' },
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Flyplass'),
        h('input', {
          type: 'text',
          value: v.icao,
          maxlength: 4,
          autocapitalize: 'characters',
          oninput: (e: Event) => {
            v.icao = (e.target as HTMLInputElement).value.toUpperCase();
            fillRwys();
            calc();
          },
        }),
      ),
      h('label', { class: 'field' }, h('span', null, 'Bane'), rwySel),
      num('QNH', 'qnh', 'hPa'),
      num('Temperatur', 'oat', '°C'),
      num('Vind fra', 'windDir', '°'),
      num('Vindstyrke', 'windKt', 'kt'),
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Gress (om ikke asfalt)'),
        h(
          'select',
          { onchange: (e: Event) => ((v.grass = (e.target as HTMLSelectElement).value as PerfInput['surface']), calc()) },
          h('option', { value: 'grass-short', selected: v.grass === 'grass-short' }, 'Kort, ≤5 cm'),
          h('option', { value: 'grass-medium', selected: v.grass === 'grass-medium' }, '5–10 cm'),
          h('option', { value: 'grass-long', selected: v.grass === 'grass-long' }, 'Langt, ~25 cm'),
        ),
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.wet, onchange: (e: Event) => ((v.wet = (e.target as HTMLInputElement).checked), calc()) }), ' Våt bane'),
    ),
    out,
  );
}
