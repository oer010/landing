import { h, section, numField } from '../dom';
import { airspaceStale } from '../../lib/airspace';
import { getAirspaceDb } from '../map';
import { state } from '../state';

export function renderSettings(el: HTMLElement): void {
  const s = state.settings;
  const check = (label: string, key: 'showAirports' | 'showNavaids' | 'showMetars' | 'showAirspace' | 'showVfrPoints' | 'showVfrCharts' | 'showNotams') =>
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: s[key], onchange: (e: Event) => state.updateSettings({ [key]: (e.target as HTMLInputElement).checked }) }),
      ` ${label}`,
    );
  el.append(
    section(
      'Kart',
      h(
        'label',
        { class: 'field' },
        h('span', null, 'Bakgrunnskart'),
        h(
          'select',
          { onchange: (e: Event) => state.updateSettings({ baseLayer: (e.target as HTMLSelectElement).value as 'osm' | 'topo' }) },
          h('option', { value: 'topo', selected: s.baseLayer === 'topo' }, 'Topografisk (OpenTopoMap)'),
          h('option', { value: 'osm', selected: s.baseLayer === 'osm' }, 'Veikart (OpenStreetMap)'),
        ),
      ),
      check('Flyplasser', 'showAirports'),
      check('Navaids (VOR/NDB)', 'showNavaids'),
      check('METAR-farger', 'showMetars'),
      check('Luftrom (Norge, fra AIP)', 'showAirspace'),
      check('VFR-rapporteringspunkter (AIP)', 'showVfrPoints'),
      check('VFR-ruter (AIP)', 'showVfrCharts'),
      check('NOTAM', 'showNotams'),
      numField('Fartsvektor', s.vectorMin, (v) => state.updateSettings({ vectorMin: v }), { unit: 'min', min: 1, max: 30 }),
    ),
    section(
      'Luftrom',
      (() => {
        const db = getAirspaceDb();
        if (!db) return h('p', { class: 'warnbox' }, 'Luftromsdata mangler i denne versjonen.');
        const cur = state.db.aipEdition;
        const stale = airspaceStale(db.airac, cur);
        return h(
          'p',
          { class: stale ? 'warnbox' : 'muted small' },
          `${db.airspaces.length} norske luftrom fra AIP Norge (utgave ${db.airac}${cur ? (stale ? `, gjeldende er ${cur}` : ', gjeldende') : ''}), konvertert av luftrom.info (relet/pg-xc). Frekvenser for ${state.db.airports.filter((a) => a.freqSource === "AIP").length} flyplasser fra AIP Norge AD 2.18${cur ? ` (${cur})` : ''}. Trykk på kartet for å se luftrommene over et punkt. Uten ansvar – sjekk alltid gjeldende AIP, VFR-kart og NOTAM.`,
        );
      })(),
    ),
    section(
      'Data',
      h('p', { class: 'muted small' }, `Flyplassdata: ${state.db.airports.length} flyplasser og ${state.db.navaids.length} navaids (${state.db.region}), generert ${new Date(state.db.generated).toLocaleDateString('nb-NO')}. Kilde: OurAirports (public domain).`),
      h(
        'button',
        {
          onclick: () => {
            if (!confirm('Slette ALLE lokale data (ruter, fly, logg, sjekklister, innstillinger)?')) return;
            Object.keys(localStorage)
              .filter((k) => k.startsWith('vfrapp.'))
              .forEach((k) => localStorage.removeItem(k));
            location.reload();
          },
        },
        'Slett alle lokale data',
      ),
    ),
    section(
      'Om appen',
      h(
        'p',
        { class: 'warnbox' },
        'Kun for VFR-planlegging og situasjonsforståelse. Ikke godkjent for navigasjon. Data kan være feil eller utdaterte – bruk alltid gjeldende AIP, VFR-kart, NOTAM og offisiell værbriefing.',
      ),
      h('p', { class: 'muted small' }, `Versjon: ${__BUILD__}`),
      h('p', { class: 'muted small' }, 'Kart © OpenStreetMap-bidragsytere og OpenTopoMap. Luftrom: AIP Norge via luftrom.info. Vær: aviationweather.gov / MET Norge. Vind: Open-Meteo. Misvisning: NOAA World Magnetic Model 2025.'),
    ),
  );
}
