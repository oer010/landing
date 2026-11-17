import { conv, densityAltitude, isaTempC, pressureAltitude, trueAirspeed, cloudBaseFt } from '../../lib/e6b';
import { fmtHdg, formatLatLon } from '../../lib/geo';
import { windComponents, windTriangle } from '../../lib/navlog';
import { sunTimes } from '../../lib/sun';
import { clear, fmt, h, section } from '../dom';
import { map } from '../map';
import { state } from '../state';

/** Lite skjema der resultatet regnes ut på nytt ved hver endring. */
function calc(title: string, fields: { key: string; label: string; unit?: string; value: number }[], compute: (v: Record<string, number>) => [string, string][]): HTMLElement {
  const vals: Record<string, number> = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  const out = h('table', { class: 'mini result' });
  const update = () =>
    clear(
      out,
      h(
        'tbody',
        null,
        compute(vals).map(([k, v]) => h('tr', null, h('td', { class: 'muted' }, k), h('td', { class: 'strong' }, v))),
      ),
    );
  const inputs = fields.map((f) =>
    h(
      'label',
      { class: 'field' },
      h('span', null, f.label),
      h(
        'span',
        { class: 'inputwrap' },
        h('input', {
          type: 'number',
          inputmode: 'decimal',
          step: 'any',
          value: f.value,
          oninput: (e: Event) => {
            const n = parseFloat((e.target as HTMLInputElement).value);
            vals[f.key] = Number.isFinite(n) ? n : 0;
            update();
          },
        }),
        f.unit ? h('span', { class: 'unit' }, f.unit) : null,
      ),
    ),
  );
  update();
  return section(title, h('div', { class: 'grid2' }, inputs), out);
}

export function renderTools(el: HTMLElement): void {
  el.append(
    calc(
      'Vindtrekant',
      [
        { key: 'tc', label: 'Kurs (TC)', unit: '°', value: 270 },
        { key: 'tas', label: 'TAS', unit: 'kt', value: state.currentAircraft.tas },
        { key: 'wd', label: 'Vind fra', unit: '°', value: 300 },
        { key: 'ws', label: 'Vindstyrke', unit: 'kt', value: 15 },
      ],
      (v) => {
        const s = windTriangle(v.tc, v.tas, { dir: v.wd, speed: v.ws });
        if (!s) return [['Resultat', 'Vinden er for sterk']];
        return [
          ['Styrekurs (TH)', `${fmtHdg(s.heading)}°`],
          ['Vindkorreksjon', `${s.wca > 0 ? '+' : ''}${s.wca.toFixed(1)}°`],
          ['Fart over bakken', `${s.groundSpeed.toFixed(0)} kt`],
        ];
      },
    ),
    calc(
      'Sidevind',
      [
        { key: 'rwy', label: 'Banenummer / retning', unit: '°', value: 19 },
        { key: 'wd', label: 'Vind fra', unit: '°', value: 220 },
        { key: 'ws', label: 'Vindstyrke', unit: 'kt', value: 12 },
        { key: 'g', label: 'Vindkast', unit: 'kt', value: 0 },
      ],
      (v) => {
        const hdg = v.rwy <= 36 ? v.rwy * 10 : v.rwy;
        const c = windComponents(hdg, { dir: v.wd, speed: v.ws });
        const g = v.g > v.ws ? windComponents(hdg, { dir: v.wd, speed: v.g }) : null;
        return [
          [c.head >= 0 ? 'Motvind' : 'Medvind', `${Math.abs(c.head).toFixed(0)} kt${g ? ` (kast ${Math.abs(g.head).toFixed(0)})` : ''}`],
          ['Sidevind', `${Math.abs(c.cross).toFixed(0)} kt fra ${c.cross >= 0 ? 'høyre' : 'venstre'}${g ? ` (kast ${Math.abs(g.cross).toFixed(0)})` : ''}`],
        ];
      },
    ),
    calc(
      'Tetthetshøyde',
      [
        { key: 'elev', label: 'Flyplasshøyde', unit: 'ft', value: 700 },
        { key: 'qnh', label: 'QNH', unit: 'hPa', value: 1013 },
        { key: 'oat', label: 'Temperatur', unit: '°C', value: 25 },
      ],
      (v) => {
        const pa = pressureAltitude(v.elev, v.qnh);
        const da = densityAltitude(pa, v.oat);
        return [
          ['Trykkhøyde', `${pa.toFixed(0)} ft`],
          ['ISA-temperatur', `${isaTempC(pa).toFixed(1)} °C (ISA ${v.oat - isaTempC(pa) >= 0 ? '+' : ''}${(v.oat - isaTempC(pa)).toFixed(0)})`],
          ['Tetthetshøyde', `${da.toFixed(0)} ft`],
        ];
      },
    ),
    calc(
      'Sann fart (TAS)',
      [
        { key: 'ias', label: 'IAS/CAS', unit: 'kt', value: 100 },
        { key: 'pa', label: 'Trykkhøyde', unit: 'ft', value: 4500 },
        { key: 'oat', label: 'Temperatur ute', unit: '°C', value: 5 },
      ],
      (v) => [['TAS', `${trueAirspeed(v.ias, v.pa, v.oat).toFixed(0)} kt`]],
    ),
    calc(
      'Tid, fart, distanse og drivstoff',
      [
        { key: 'd', label: 'Distanse', unit: 'NM', value: 60 },
        { key: 'gs', label: 'Fart (GS)', unit: 'kt', value: 100 },
        { key: 'ff', label: 'Forbruk', unit: '/t', value: state.currentAircraft.fuelBurn },
      ],
      (v) => {
        const t = v.gs > 0 ? (v.d / v.gs) * 60 : 0;
        return [
          ['Tid', `${Math.floor(t / 60)} t ${Math.round(t % 60)} min`],
          ['Drivstoff', `${((t / 60) * v.ff).toFixed(1)}`],
        ];
      },
    ),
    calc(
      'Skybase fra temperatur/duggpunkt',
      [
        { key: 't', label: 'Temperatur', unit: '°C', value: 15 },
        { key: 'd', label: 'Duggpunkt', unit: '°C', value: 8 },
      ],
      (v) => [['Omtrentlig skybase', `${cloudBaseFt(v.t, v.d).toFixed(0)} ft AGL`]],
    ),
    calc(
      'Omregning',
      [
        { key: 'v', label: 'Verdi', value: 1 },
      ],
      (v) => [
        ['ft → m', `${conv.ftToM(v.v).toFixed(1)} m`],
        ['m → ft', `${conv.mToFt(v.v).toFixed(0)} ft`],
        ['NM → km', `${conv.nmToKm(v.v).toFixed(2)} km`],
        ['km → NM', `${conv.kmToNm(v.v).toFixed(2)} NM`],
        ['kt → km/t', `${conv.ktToKmh(v.v).toFixed(1)} km/t`],
        ['m/s → kt', `${conv.msToKt(v.v).toFixed(1)} kt`],
        ['°C → °F', `${conv.cToF(v.v).toFixed(1)} °F`],
        ['hPa → inHg', `${conv.hpaToInHg(v.v).toFixed(2)} inHg`],
        ['inHg → hPa', `${conv.inHgToHpa(v.v).toFixed(1)} hPa`],
        ['L → USG', `${conv.lToUsg(v.v).toFixed(2)} USG`],
        ['USG → L', `${conv.usgToL(v.v).toFixed(1)} L`],
        ['kg → lb', `${conv.kgToLb(v.v).toFixed(1)} lb`],
        ['lb → kg', `${conv.lbToKg(v.v).toFixed(1)} kg`],
        ['L avgas → kg', `${conv.avgasLToKg(v.v).toFixed(1)} kg`],
      ],
    ),
    sunSection(),
  );
}

function sunSection(): HTMLElement {
  const p = state.position ?? (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : { lat: 60, lon: 10 });
  const today = new Date();
  const rows = [0, 1, 2].map((d) => {
    const date = new Date(today.getTime() + d * 86400000);
    const s = sunTimes(date, p.lat, p.lon);
    return h(
      'tr',
      null,
      h('td', null, fmt.date(date)),
      h('td', null, s.polar === 'midnight-sun' ? 'Midnattssol' : s.polar === 'polar-night' ? 'Mørketid' : `${fmt.time(s.sunrise)} – ${fmt.time(s.sunset)}`),
      h('td', null, s.civilPolar === 'normal' ? `${fmt.time(s.civilDawn)} – ${fmt.time(s.civilDusk)}` : s.civilPolar === 'always-light' ? 'Lyst' : 'Mørkt'),
    );
  });
  return section(
    'Sol og dagslys',
    h('p', { class: 'muted small' }, `${state.position ? 'Din posisjon' : 'Kartets midtpunkt'}: ${formatLatLon(p)}`),
    h('table', { class: 'mini' }, h('thead', null, h('tr', null, ['Dato', 'Sol opp/ned', 'Sivil skumring'].map((c) => h('th', null, c)))), h('tbody', null, rows)),
  );
}
