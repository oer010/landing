import { h, section, numField } from '../dom';
import { offlineSection } from './offline';
import { airspaceStale } from '../../lib/airspace';
import { getAirspaceDb } from '../map';
import { state } from '../state';

export function renderSettings(el: HTMLElement): void {
  const s = state.settings;
  const check = (label: string, key: 'showAirports' | 'showNavaids' | 'showMetars' | 'showAirspace' | 'showVfrPoints' | 'showVfrCharts' | 'showNotams' | 'showObstacles' | 'showSigmet' | 'showIsogons' | 'alertAirspace' | 'alertObstacles' | 'alertTerrain' | 'alertSound') =>
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
          { onchange: (e: Event) => state.updateSettings({ baseLayer: (e.target as HTMLSelectElement).value as 'osm' | 'topo' | 'kv' }) },
          h('option', { value: 'kv', selected: s.baseLayer === 'kv' }, 'Topografisk (Kartverket) – kan lastes ned'),
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
      check('Hindre (master, tårn, vindturbiner)', 'showObstacles'),
      check('SIGMET/AIRMET-områder', 'showSigmet'),
      check('Misvisning (isogoner, WMM 2025)', 'showIsogons'),
      numField('Fartsvektor', s.vectorMin, (v) => state.updateSettings({ vectorMin: v }), { unit: 'min', min: 1, max: 30 }),
    ),
    section(
      'Varsler i lufta (GPS)',
      h('p', { class: 'muted small' }, 'Varsler øverst i kartet når GPS er på og farten er over 40 kt. Trykk på varselet for å skjule det.'),
      check('Luftrom: varsel 2 min før du flyr inn i CTR/TMA/TIZ/RMZ og restriksjons-/fareområder', 'alertAirspace'),
      check('Hindre: varsel når et hinder foran er mindre enn 500 ft under deg', 'alertObstacles'),
      check('Terreng: varsel når terreng innen 2 min foran er mindre enn 500 ft under deg (krever nett)', 'alertTerrain'),
      check('Lyd ved varsel', 'alertSound'),
    ),
    offlineSection(),
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
      h('p', { class: 'muted small' }, 'Kart © Kartverket (CC BY 4.0), OpenStreetMap-bidragsytere og OpenTopoMap. Luftrom: AIP Norge via luftrom.info. Vær: aviationweather.gov / MET Norge. Vind: Open-Meteo. Misvisning: NOAA World Magnetic Model 2025.'),
    ),
  );
}
