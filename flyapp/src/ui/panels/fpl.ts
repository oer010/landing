// Flightplan: fullt ICAO-skjema med kontroll, og levering via IPPC eller telefon til AIS.
// AIP Norge ENR 1.10: flightplan leveres til AIS/ARO (telefon, faks, oppmøte) – i praksis
// også via IPPC (ippc.no, krever innlogging). Det finnes ingen åpen tjeneste appen kan sende til.

import { checkFpl, fplRoute, icaoFlightPlan, type Fpl19 } from '../../lib/export';
import { load, save } from '../../lib/store';
import { h, section, toast } from '../dom';
import { state } from '../state';

const AIS_TEL = '+4764819000';
const AIS_TEL_TEXT = '+47 64 81 90 00';
const IPPC_URL = 'https://www.ippc.no/ippc/';

interface FplDefaults extends Fpl19 {
  phone?: string;
}
interface FiledPlan {
  id: string;
  callsign: string;
  dep: string;
  dest: string;
  eobt: string;
  eta: string;
  filedAt: string;
  via: 'IPPC' | 'telefon' | 'annet';
  closed?: boolean;
}

let open = false;
/** Skjemaverdier som overlever at panelet tegnes på nytt. */
const form: { routeKey: string; callsign?: string; eobt?: string; levelVfr: boolean; route?: string; alt1?: string; alt2?: string; persons?: number; eet?: number; endurance?: number; rmk?: string } = {
  routeKey: '',
  levelVfr: false,
};
let defaults = load<FplDefaults>('fplDefaults', {});
let filed = load<FiledPlan[]>('fplFiled', []);

export const isFplOpen = () => open;
export function toggleFpl(): void {
  open = !open;
  state.emit('route');
  if (open) setTimeout(() => document.getElementById('fpl-section')?.scrollIntoView({ behavior: 'smooth' }), 50);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** «2026-11-25T14:35» i UTC for <input type=datetime-local> tolket som UTC. */
const toUtcInput = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const fromUtcInput = (s: string) => new Date(`${s}:00Z`);
const hhmmToMin = (s: string) => {
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : NaN;
};
const minToHhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;

/** Påminnelse om leverte planer (ankomstmelding / kansellering), øverst i Rute-fanen. */
export function filedPlansBox(): HTMLElement | null {
  const now = Date.now();
  const active = filed.filter((f) => !f.closed && now - new Date(f.eta).getTime() < 6 * 3600e3);
  if (!active.length) return null;
  return section(
    'Leverte flightplaner',
    active.map((f) =>
      h(
        'div',
        { class: 'fpl-filed' },
        h('strong', null, `${f.callsign} ${f.dep} → ${f.dest}`),
        h('div', { class: 'muted small' }, `EOBT ${f.eobt.slice(11, 16)}Z · ETA ${f.eta.slice(11, 16)}Z · levert via ${f.via}`),
        h('div', { class: 'small' }, 'Lander du der det ikke er TWR/AFIS, eller blir det endringer: ring AIS for ankomstmelding / kansellering, ellers kan det startes leteaksjon.'),
        h(
          'div',
          { class: 'row wrap' },
          h('a', { class: 'btn', href: `tel:${AIS_TEL}` }, `📞 AIS ${AIS_TEL_TEXT}`),
          h(
            'button',
            {
              onclick: () => {
                f.closed = true;
                save('fplFiled', filed);
                state.emit('route');
              },
            },
            '✓ Landet / avsluttet',
          ),
        ),
      ),
    ),
  );
}

export function fplSection(eetMin: number, enduranceMin: number): HTMLElement | null {
  if (!open) return null;
  const r = state.route;
  const ac = state.currentAircraft;
  const wps = r.waypoints;
  // Ny rute: start skjemaet på nytt med verdier fra ruten.
  const key = wps.map((w) => w.id).join('-');
  if (form.routeKey !== key) {
    Object.assign(form, { routeKey: key, callsign: undefined, route: undefined, alt1: r.alternate || undefined, alt2: undefined, eet: undefined, endurance: undefined, persons: undefined, rmk: undefined });
  }
  const now = Date.now();
  const defEobt = r.departureTime ? new Date(r.departureTime) : new Date(Math.ceil((now + 60 * 60e3) / 300e3) * 300e3);
  const v = {
    callsign: form.callsign ?? ac.registration.replace(/-/g, '').toUpperCase(),
    eobt: form.eobt ?? toUtcInput(defEobt < new Date(now) ? new Date(Math.ceil((now + 60 * 60e3) / 300e3) * 300e3) : defEobt),
    route: form.route ?? fplRoute(wps),
    alt1: form.alt1 ?? '',
    alt2: form.alt2 ?? '',
    persons: form.persons ?? r.persons ?? 1,
    eet: form.eet ?? Math.round(eetMin),
    endurance: form.endurance ?? Math.floor(enduranceMin),
    rmk: form.rmk ?? (defaults.phone ? `PIC TEL ${defaults.phone}` : ''),
  };
  const preview = h('textarea', { class: 'fpl', rows: 9, readonly: true });
  const checks = h('ul', { class: 'checks' });
  let text = '';
  const update = () => {
    const eobt = fromUtcInput(v.eobt);
    text = icaoFlightPlan({
      aircraft: ac,
      waypoints: wps,
      eobt,
      eetMin: v.eet,
      enduranceMin: v.endurance,
      altitudeFt: r.altitudeFt,
      tas: ac.tas,
      persons: v.persons,
      callsign: v.callsign,
      levelVfr: form.levelVfr,
      route: v.route,
      alternates: [v.alt1, v.alt2],
      remarks: v.rmk || undefined,
      item19: defaults,
    });
    preview.value = text;
    const res = checkFpl({ callsign: v.callsign, aircraft: ac, waypoints: wps, eobt, eetMin: v.eet, enduranceMin: v.endurance, persons: v.persons, pilot: defaults.pilot });
    checks.replaceChildren(
      ...(res.length
        ? res.map((c) => h('li', { class: c.level === 'error' ? 'bad' : 'warn' }, `${c.level === 'error' ? '✗' : '!'} ${c.text}`))
        : [h('li', { class: 'good' }, '✓ Alle påkrevde felt er fylt ut')]),
    );
    const blocked = res.some((c) => c.level === 'error');
    for (const b of actionBtns) b.disabled = blocked;
  };
  const field = (label: string, input: HTMLElement, hint?: string) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);
  const text_ = (val: string, set: (s: string) => void, attrs: Record<string, unknown> = {}) =>
    h('input', { type: 'text', value: val, autocapitalize: 'characters', spellcheck: 'false', ...attrs, oninput: (e: Event) => (set((e.target as HTMLInputElement).value), update()) });
  const def = <K extends keyof FplDefaults>(k: K) => (val: string) => {
    defaults = { ...defaults, [k]: val };
    save('fplDefaults', defaults);
  };
  const choice = (k: 'radio' | 'survival' | 'jackets', opts: [string, string][]) =>
    h(
      'div',
      { class: 'row wrap fpl-opts' },
      opts.map(([c, label]) =>
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: (defaults[k] ?? '').includes(c),
            onchange: (e: Event) => {
              const cur = new Set((defaults[k] ?? '').split(''));
              if ((e.target as HTMLInputElement).checked) cur.add(c);
              else cur.delete(c);
              def(k)(opts.map(([o]) => o).filter((o) => cur.has(o)).join(''));
              update();
            },
          }),
          ` ${label}`,
        ),
      ),
    );

  const markFiled = (via: FiledPlan['via']) => {
    const eobt = fromUtcInput(v.eobt);
    filed = [
      { id: `${Date.now()}`, callsign: v.callsign, dep: wps[0]?.id ?? '', dest: wps[wps.length - 1]?.id ?? '', eobt: eobt.toISOString(), eta: new Date(eobt.getTime() + (v.eet + 10) * 60e3).toISOString(), filedAt: new Date().toISOString(), via },
      ...filed.slice(0, 19),
    ];
    save('fplFiled', filed);
    open = false;
    toast('Flightplan registrert som levert. Husk å vente på bekreftelse fra AIS/IPPC.', 'info', 7000);
    state.emit('route');
  };
  const copy = () => navigator.clipboard?.writeText(text).then(() => toast('Flightplan kopiert')).catch(() => toast('Kunne ikke kopiere – merk teksten og kopier selv', 'warn'));
  const actionBtns: HTMLButtonElement[] = [
    h(
      'button',
      {
        class: 'primary',
        onclick: () => {
          void copy();
          window.open(IPPC_URL, '_blank', 'noopener');
          setTimeout(() => {
            if (confirm('Leverte du planen i IPPC? Trykk OK for å registrere den i appen (for påminnelse om ankomstmelding).')) markFiled('IPPC');
          }, 1500);
        },
      },
      '1 · Kopier og åpne IPPC',
    ) as HTMLButtonElement,
    h(
      'button',
      {
        onclick: () => {
          location.href = `tel:${AIS_TEL}`;
          setTimeout(() => {
            if (confirm('Leverte du planen til AIS på telefon? Trykk OK for å registrere den i appen.')) markFiled('telefon');
          }, 4000);
        },
      },
      `2 · Ring AIS (${AIS_TEL_TEXT})`,
    ) as HTMLButtonElement,
    h(
      'button',
      {
        onclick: () => {
          if (navigator.share) void navigator.share({ title: `Flightplan ${v.callsign}`, text }).catch(() => undefined);
          else void copy();
        },
      },
      'Del / send',
    ) as HTMLButtonElement,
  ];

  const sec = section(
    'Flightplan (ICAO)',
    h(
      'p',
      { class: 'muted small' },
      'Fylles ut fra ruten og flyprofilen. Kontroller alt. Levering: kopier og lim inn i IPPC (ippc.no, egen innlogging), eller ring Central AIS og les opp planen. VFR i Polaris FIR: senest 30 min før avgang (AIP ENR 1.10).',
    ),
    h(
      'div',
      { class: 'grid2' },
      field('Kallesignal (7)', text_(v.callsign, (s) => (form.callsign = v.callsign = s.toUpperCase()), { maxlength: 7 })),
      field(
        'EOBT (UTC)',
        h('input', {
          type: 'datetime-local',
          value: v.eobt,
          step: 300,
          oninput: (e: Event) => {
            form.eobt = v.eobt = (e.target as HTMLInputElement).value;
            update();
          },
        }),
        'Avgangstid i UTC (lokal tid = UTC + 1, sommertid + 2)',
      ),
      field(
        'Nivå (15)',
        h(
          'select',
          {
            onchange: (e: Event) => {
              form.levelVfr = (e.target as HTMLSelectElement).value === 'VFR';
              update();
            },
          },
          h('option', { value: 'A', selected: !form.levelVfr }, `A${String(Math.round(r.altitudeFt / 100)).padStart(3, '0')} (${r.altitudeFt} ft)`),
          h('option', { value: 'VFR', selected: form.levelVfr }, 'VFR (uten fast høyde)'),
        ),
      ),
      field('Personer om bord (P/)', h('input', { type: 'number', min: 1, max: 9, value: v.persons, oninput: (e: Event) => ((form.persons = v.persons = +(e.target as HTMLInputElement).value || 0), update()) })),
      field('EET (tt:mm)', text_(minToHhmm(v.eet), (s) => { const m = hhmmToMin(s); if (Number.isFinite(m)) form.eet = v.eet = m; }, { inputmode: 'numeric' }), 'Beregnet fra navloggen'),
      field('Utholdenhet E/ (tt:mm)', text_(minToHhmm(v.endurance), (s) => { const m = hhmmToMin(s); if (Number.isFinite(m)) form.endurance = v.endurance = m; }, { inputmode: 'numeric' }), 'Fra drivstoff om bord'),
      field('Alternativ 1', text_(v.alt1, (s) => (form.alt1 = v.alt1 = s.toUpperCase()), { maxlength: 4, placeholder: 'ICAO' })),
      field('Alternativ 2', text_(v.alt2, (s) => (form.alt2 = v.alt2 = s.toUpperCase()), { maxlength: 4, placeholder: 'ICAO' })),
    ),
    field('Rute (15)', h('textarea', { rows: 2, class: 'fpl-route', oninput: (e: Event) => ((form.route = v.route = (e.target as HTMLTextAreaElement).value.toUpperCase()), update()) }, v.route), 'DCT mellom punkter; koordinater for egne punkter'),
    field('Merknad (RMK/)', text_(v.rmk, (s) => (form.rmk = v.rmk = s.toUpperCase()), { placeholder: 'f.eks. PIC TEL 99999999' })),
    h('h4', null, 'Felt 19 og fartøysjef (huskes til neste gang)'),
    h(
      'div',
      { class: 'grid2' },
      field('Fartøysjef (C/)', text_(defaults.pilot ?? '', (s) => def('pilot')(s), { autocapitalize: 'words', placeholder: 'Fornavn Etternavn' })),
      field('Telefon fartøysjef', text_(defaults.phone ?? '', (s) => def('phone')(s), { inputmode: 'tel', placeholder: '+47 …' }), 'Legges i RMK for nye planer'),
    ),
    h('div', { class: 'muted small' }, 'Nødradio (R/)'),
    choice('radio', [['U', 'UHF 243'], ['V', 'VHF 121,5'], ['E', 'ELT']]),
    h('div', { class: 'muted small' }, 'Overlevelsesutstyr (S/)'),
    choice('survival', [['P', 'Polar'], ['D', 'Ørken'], ['M', 'Maritim'], ['J', 'Jungel']]),
    h('div', { class: 'muted small' }, 'Redningsvester (J/)'),
    choice('jackets', [['L', 'Lys'], ['F', 'Fluorescein'], ['U', 'UHF'], ['V', 'VHF']]),
    h('div', { class: 'grid2' }, field('Flåter (D/)', text_(defaults.dinghies ?? '', (s) => def('dinghies')(s), { placeholder: 'f.eks. 01 004 C ORANGE' })), field('Andre merknader (N/)', text_(defaults.remarks ?? '', (s) => def('remarks')(s)))),
    h('h4', null, 'Kontroll'),
    checks,
    h('h4', null, 'Ferdig plan'),
    preview,
    h('div', { class: 'row wrap fpl-actions' }, ...actionBtns),
    h('p', { class: 'muted small' }, 'Appen leverer ikke planen selv. Planen er levert først når IPPC eller AIS har bekreftet den. Endringer/kansellering: ring AIS.'),
  );
  sec.id = 'fpl-section';
  update();
  return sec;
}
