import { distanceNm } from '../../lib/geo';
import { computeWB, type WBResult } from '../../lib/wb';
import { exampleAircraft, perfOf, uid, type Aircraft } from '../../lib/store';
import { fmt, h, numField, section, textField, toast } from '../dom';
import { state } from '../state';

export function renderAircraft(el: HTMLElement): void {
  const ac = state.currentAircraft;
  const persist = () => state.saveAircraft();
  const set = <K extends keyof Aircraft>(k: K) => (v: Aircraft[K]) => {
    ac[k] = v;
    persist();
  };
  const wu = ac.weightUnit;
  const pf = perfOf(ac);
  const au = ac.armUnit;

  // Drivstoff om bord i volum for M&B-stasjonen
  const fuelStation = ac.stations.find((s) => s.fuel);
  const fuelLitres = fuelStation ? fuelStation.weight / ac.fuelDensity : 0;
  const routeLegsFuel = estimateTripFuel();

  const wb = computeWB({
    emptyWeight: ac.emptyWeight,
    emptyArm: ac.emptyArm,
    stations: ac.stations,
    envelope: ac.envelope,
    maxTakeoffWeight: ac.mtow,
    fuelBurnWeight: routeLegsFuel * ac.fuelDensity,
  });

  el.append(
    section(
      'Fly',
      h(
        'div',
        { class: 'row' },
        h(
          'select',
          {
            class: 'grow',
            onchange: (e: Event) => {
              state.currentAircraftId = (e.target as HTMLSelectElement).value;
              persist();
            },
          },
          state.aircraft.map((a) => h('option', { value: a.id, selected: a.id === ac.id }, `${a.registration} – ${a.type}`)),
        ),
        h(
          'button',
          {
            onclick: () => {
              const n = { ...structuredClone(ac), id: uid(), registration: 'LN-NEW', type: `Kopi av ${ac.type}` };
              state.aircraft.push(n);
              state.currentAircraftId = n.id;
              persist();
            },
          },
          'Kopier',
        ),
        h(
          'button',
          {
            onclick: () => {
              if (state.aircraft.length < 2) return toast('Du må ha minst ett fly', 'warn');
              if (!confirm(`Slette ${ac.registration}?`)) return;
              state.aircraft = state.aircraft.filter((a) => a.id !== ac.id);
              state.currentAircraftId = state.aircraft[0].id;
              persist();
            },
          },
          'Slett',
        ),
      ),
      ac.id === 'example' ? h('p', { class: 'warnbox' }, 'Dette er en eksempelprofil med oppdiktede tall. Legg inn verdiene fra ditt flys veie- og balanserapport og POH før bruk.') : null,
      h(
        'div',
        { class: 'grid2' },
        textField('Registrering', ac.registration, set('registration')),
        textField('Type', ac.type, set('type')),
        textField('ICAO-type', ac.icaoType, set('icaoType')),
        textField('Farge (FPL)', ac.colour, set('colour')),
        textField('Utstyr (felt 10a)', ac.equipment, set('equipment')),
        textField('Transponder (10b)', ac.surveillance, set('surveillance')),
        numField('TAS marsj', ac.tas, set('tas'), { unit: 'kt' }),
        numField('Forbruk', ac.fuelBurn, set('fuelBurn'), { unit: `${ac.fuelUnit}/t` }),
        numField('Brukbart drivstoff', ac.usableFuel, set('usableFuel'), { unit: ac.fuelUnit }),
        numField('Tetthet drivstoff', ac.fuelDensity, set('fuelDensity'), { unit: `${wu}/${ac.fuelUnit}`, step: 0.01 }),
        unitSelect('Drivstoffenhet', ac.fuelUnit, ['L', 'USG'], (v) => set('fuelUnit')(v as Aircraft['fuelUnit'])),
        unitSelect('Vekt/arm', `${wu}/${au}`, ['kg/m', 'lb/in'], (v) => {
          const [w, a] = v.split('/') as [Aircraft['weightUnit'], Aircraft['armUnit']];
          ac.weightUnit = w;
          ac.armUnit = a;
          persist();
        }),
      ),
    ),
    section(
      'Klatring og nedstigning',
      h('p', { class: 'muted small' }, 'Brukes i navloggen til TOC/TOD, tid og drivstoff. Hent tallene fra POH (gjennomsnitt for typisk høyde).'),
      h(
        'div',
        { class: 'grid2' },
        numField('Klatring TAS', pf.climbTas, (v) => set('climbTas')(v), { unit: 'kt' }),
        numField('Stigehastighet', pf.climbFpm, (v) => set('climbFpm')(v), { unit: 'ft/min', step: 50 }),
        numField('Forbruk klatring', pf.climbBurn, (v) => set('climbBurn')(v), { unit: `${ac.fuelUnit}/t` }),
        numField('Nedstigning TAS', pf.descentTas, (v) => set('descentTas')(v), { unit: 'kt' }),
        numField('Synkehastighet', pf.descentFpm, (v) => set('descentFpm')(v), { unit: 'ft/min', step: 50 }),
        numField('Forbruk nedstigning', pf.descentBurn, (v) => set('descentBurn')(v), { unit: `${ac.fuelUnit}/t` }),
      ),
    ),
    section(
      'Masse og balanse',
      h(
        'div',
        { class: 'grid2' },
        numField('Tomvekt', ac.emptyWeight, set('emptyWeight'), { unit: wu }),
        numField('Tomvekt arm', ac.emptyArm, set('emptyArm'), { unit: au, step: 0.001 }),
        numField('MTOW', ac.mtow, set('mtow'), { unit: wu }),
      ),
      h(
        'div',
        { class: 'tablewrap' },
        h(
          'table',
          { class: 'mini stations' },
          h('thead', null, h('tr', null, ['Stasjon', `Arm (${au})`, `Last (${wu})`, `Maks`, ''].map((c) => h('th', null, c)))),
          h(
            'tbody',
            null,
            ac.stations.map((s, i) =>
              h(
                'tr',
                null,
                h('td', null, cellText(s.name, (v) => ((s.name = v), persist()))),
                h('td', null, cellNum(s.arm, (v) => ((s.arm = v), persist()), 0.001)),
                h(
                  'td',
                  null,
                  s.fuel
                    ? h(
                        'span',
                        { class: 'fuelcell' },
                        cellNum(Math.round(fuelLitres * 10) / 10, (v) => ((s.weight = v * ac.fuelDensity), persist())),
                        h('span', { class: 'muted small' }, ` ${ac.fuelUnit} = ${fmt.n(s.weight, 1)} ${wu}`),
                      )
                    : cellNum(s.weight, (v) => ((s.weight = v), persist())),
                ),
                h('td', null, cellNum(s.max ?? null, (v) => ((s.max = v || undefined), persist()))),
                h('td', null, h('button', { title: 'Fjern', onclick: () => (ac.stations.splice(i, 1), persist()) }, '✕')),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { onclick: () => (ac.stations.push({ name: 'Ny stasjon', arm: 1, weight: 0 }), persist()) }, '+ Stasjon'),
        !fuelStation ? h('button', { onclick: () => (ac.stations.push({ name: 'Drivstoff', arm: 1, weight: 0, fuel: true }), persist()) }, '+ Drivstofftank') : null,
      ),
      wbSummary(wb, wu, au, routeLegsFuel, ac.fuelUnit),
      envelopeChart(ac, wb),
    ),
    section(
      'Tyngdepunktsgrense (envelope)',
      h('p', { class: 'muted small' }, 'Hjørnene i godkjent område fra POH, i rekkefølge rundt polygonet.'),
      h(
        'table',
        { class: 'mini' },
        h('thead', null, h('tr', null, [`Arm (${au})`, `Vekt (${wu})`, ''].map((c) => h('th', null, c)))),
        h(
          'tbody',
          null,
          ac.envelope.map((p, i) =>
            h(
              'tr',
              null,
              h('td', null, cellNum(p.arm, (v) => ((p.arm = v), persist()), 0.001)),
              h('td', null, cellNum(p.weight, (v) => ((p.weight = v), persist()))),
              h('td', null, h('button', { onclick: () => (ac.envelope.splice(i, 1), persist()) }, '✕')),
            ),
          ),
        ),
      ),
      h('button', { onclick: () => (ac.envelope.push({ arm: ac.emptyArm, weight: ac.mtow }), persist()) }, '+ Punkt'),
      h(
        'button',
        {
          class: 'link',
          onclick: () => {
            if (!confirm('Erstatte dette flyet med eksempelverdiene?')) return;
            Object.assign(ac, { ...exampleAircraft(), id: ac.id });
            persist();
          },
        },
        'Tilbakestill til eksempel',
      ),
    ),
  );
}

function estimateTripFuel(): number {
  // Grov tur-drivstoff fra ruten uten vind (brukes til landings-CG).
  const wps = state.route.waypoints;
  const ac = state.currentAircraft;
  let d = 0;
  for (let i = 1; i < wps.length; i++) d += distanceNm(wps[i - 1], wps[i]);
  return ac.tas > 0 ? (d / ac.tas) * ac.fuelBurn : 0;
}

function wbSummary(wb: WBResult, wu: string, au: string, tripFuel: number, fuelUnit: string): HTMLElement {
  const line = (label: string, s: WBResult['takeoff']) =>
    h(
      'tr',
      { class: s.withinEnvelope && !s.overweight ? 'good' : 'bad' },
      h('td', null, label),
      h('td', null, `${fmt.n(s.weight, 1)} ${wu}`),
      h('td', null, `${fmt.n(s.cg, 3)} ${au}`),
      h('td', null, `${fmt.n(s.moment, 1)}`),
      h('td', null, s.overweight ? 'Overvekt!' : s.withinEnvelope ? 'OK' : 'Utenfor!'),
    );
  return h(
    'div',
    null,
    h(
      'table',
      { class: 'mini' },
      h('thead', null, h('tr', null, ['', 'Vekt', 'CG', 'Moment', 'Status'].map((c) => h('th', null, c)))),
      h('tbody', null, line('Avgang', wb.takeoff), line('Landing', wb.landing)),
    ),
    tripFuel > 0 ? h('p', { class: 'muted small' }, `Landing beregnet med ${fmt.n(tripFuel, 1)} ${fuelUnit} brukt (ruten uten vind).`) : null,
    wb.stationErrors.length ? h('p', { class: 'warnbox' }, wb.stationErrors.join(' · ')) : null,
  );
}

function envelopeChart(ac: Aircraft, wb: WBResult): SVGSVGElement | null {
  if (ac.envelope.length < 3) return null;
  const pts = [...ac.envelope, { arm: wb.takeoff.cg, weight: wb.takeoff.weight }, { arm: wb.landing.cg, weight: wb.landing.weight }];
  const minA = Math.min(...pts.map((p) => p.arm));
  const maxA = Math.max(...pts.map((p) => p.arm));
  const minW = Math.min(...pts.map((p) => p.weight));
  const maxW = Math.max(...pts.map((p) => p.weight));
  const W = 320;
  const H = 220;
  const pad = 36;
  const padA = (maxA - minA) * 0.1 || 0.1;
  const padW = (maxW - minW) * 0.1 || 10;
  const x = (a: number) => pad + ((a - (minA - padA)) / (maxA - minA + 2 * padA)) * (W - pad - 10);
  const y = (w: number) => H - pad - ((w - (minW - padW)) / (maxW - minW + 2 * padW)) * (H - pad - 10);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'envelope');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tyngdepunktsdiagram');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  add('line', { x1: pad, y1: H - pad, x2: W - 10, y2: H - pad, class: 'axis' });
  add('line', { x1: pad, y1: 10, x2: pad, y2: H - pad, class: 'axis' });
  add('text', { x: pad, y: H - pad + 16, class: 'tick' }, (minA - padA).toFixed(2));
  add('text', { x: W - 10, y: H - pad + 16, class: 'tick', 'text-anchor': 'end' }, (maxA + padA).toFixed(2));
  add('text', { x: (W + pad) / 2, y: H - 4, class: 'tick', 'text-anchor': 'middle' }, `CG (${ac.armUnit})`);
  add('text', { x: pad - 4, y: y(maxW), class: 'tick', 'text-anchor': 'end' }, String(Math.round(maxW)));
  add('text', { x: pad - 4, y: y(minW), class: 'tick', 'text-anchor': 'end' }, String(Math.round(minW)));
  add('polygon', { points: ac.envelope.map((p) => `${x(p.arm)},${y(p.weight)}`).join(' '), class: 'env' });
  add('line', { x1: pad, x2: W - 10, y1: y(ac.mtow), y2: y(ac.mtow), class: 'mtow' });
  add('line', { x1: x(wb.takeoff.cg), y1: y(wb.takeoff.weight), x2: x(wb.landing.cg), y2: y(wb.landing.weight), class: 'burn' });
  add('circle', { cx: x(wb.takeoff.cg), cy: y(wb.takeoff.weight), r: 6, class: wb.takeoff.withinEnvelope && !wb.takeoff.overweight ? 'pt ok' : 'pt bad' });
  add('circle', { cx: x(wb.landing.cg), cy: y(wb.landing.weight), r: 4, class: wb.landing.withinEnvelope ? 'pt ok land' : 'pt bad land' });
  add('text', { x: x(wb.takeoff.cg) + 9, y: y(wb.takeoff.weight) + 4, class: 'lbl' }, 'Avgang');
  add('text', { x: x(wb.landing.cg) + 9, y: y(wb.landing.weight) + 4, class: 'lbl' }, 'Landing');
  return svg;
}

function cellNum(v: number | null, onChange: (v: number) => void, step = 1): HTMLInputElement {
  return h('input', {
    type: 'number',
    inputmode: 'decimal',
    step,
    value: v ?? '',
    onchange: (e: Event) => {
      const n = parseFloat((e.target as HTMLInputElement).value);
      onChange(Number.isFinite(n) ? n : 0);
    },
  });
}

function cellText(v: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', { type: 'text', value: v, onchange: (e: Event) => onChange((e.target as HTMLInputElement).value) });
}

function unitSelect(label: string, value: string, options: string[], onChange: (v: string) => void): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, options.map((o) => h('option', { value: o, selected: o === value }, o))),
  );
}

