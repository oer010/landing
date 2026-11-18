import { fmtHdg } from '../../lib/geo';
import { fetchForecastWind, windStatus } from '../autowind';
import { renameWaypoint } from '../naming';
import { airspaceStale, airspacesAlongRoute, fmtLimits, KIND_ADVICE, KIND_STYLE } from '../../lib/airspace';
import type { Waypoint, Wind } from '../../lib/navlog';
import { fmtVar } from '../../lib/mag';
import { computeNavlog, fmtMin, fuelPlan, legAltitudes, suggestVfrAltitude, vfrCruiseAltitudeOk, type NavlogLeg } from '../../lib/navlog';
import { categoryOf, CATEGORY_COLORS, fetchMetars, wxError } from '../../lib/metar';
import { isNight, sunTimes } from '../../lib/sun';
import { download, icaoFlightPlan, routeToFpl, routeToGpx } from '../../lib/export';
import { perfOf, uid } from '../../lib/store';
import { computeProfile, PATTERN_AGL, type Profile } from '../../lib/profile';
import { isNative } from '../../lib/platform';
import { badge, clear, fmt, h, numField, section, textField, toast } from '../dom';
import { fitRoute, getAirspaceDb, isEditMode, setEditMode } from '../map';
import { setActiveIndex, startSim, stopSim, simActive } from '../position';
import { activeLegWinds, airportToWaypoint, parseRouteString, routeToString, state } from '../state';
import { searchAirports } from '../../lib/data';

export function renderRoute(el: HTMLElement): void {
  const r = state.route;
  const ac = state.currentAircraft;
  const wps = r.waypoints;
  const dep = r.departureTime ? new Date(r.departureTime) : new Date();
  const legWinds = activeLegWinds(r);
  const legs = computeNavlog(wps, {
    tas: ac.tas,
    wind: { dir: r.windDir, speed: r.windSpeed },
    legWinds,
    fuelBurn: ac.fuelBurn,
    altitudeFt: r.altitudeFt,
    date: dep,
  });
  const prof = computeProfile(wps, legs, perfOf(ac));
  // Totaler inkl. klatring/nedstigning.
  const last = { cumDist: prof.totalDist, cumMin: prof.totalMin, cumFuel: prof.totalFuel };

  const routeInput = h('input', {
    type: 'text',
    class: 'route-input',
    value: routeToString(wps),
    placeholder: 'f.eks. ENKJ 6030N00930E ENBR',
    autocapitalize: 'characters',
    spellcheck: 'false',
    onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && applyText(),
  });
  const applyText = () => {
    const { waypoints, errors } = parseRouteString(state.db, routeInput.value);
    if (errors.length) toast(`Ukjent: ${errors.join(', ')}`, 'warn');
    state.setWaypoints(waypoints);
    fitRoute();
  };

  const wpList = h(
    'ol',
    { class: 'wplist' },
    wps.map((w, i) =>
      h(
        'li',
        { class: i === state.activeIndex && !state.directTo ? 'active' : '' },
        h('span', { class: 'wp-id' }, w.id),
        h('span', { class: 'muted small grow' }, w.name ?? (w.kind === 'user' ? 'Brukerpunkt' : '')),
        h(
          'span',
          { class: 'btns' },
          h(
            'button',
            {
              title: 'Gi navn',
              onclick: () => {
                const n = prompt('Navn på punktet (tomt = finn stedsnavn automatisk):', w.manualName ? w.id : '');
                if (n !== null) renameWaypoint(i, n);
              },
            },
            '✎',
          ),
          h('button', { title: 'Aktiver legg', onclick: () => setActiveIndex(i), disabled: i === 0 }, '▶'),
          h('button', { title: 'Flytt opp', onclick: () => move(i, -1), disabled: i === 0 }, '↑'),
          h('button', { title: 'Flytt ned', onclick: () => move(i, 1), disabled: i === wps.length - 1 }, '↓'),
          h('button', { title: 'Fjern', onclick: () => state.setWaypoints(wps.filter((_, j) => j !== i)) }, '✕'),
        ),
      ),
    ),
  );
  const move = (i: number, d: number) => {
    const next = [...wps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    state.setWaypoints(next);
  };

  // Flyvalg
  const acSelect = h(
    'select',
    {
      onchange: (e: Event) => {
        state.currentAircraftId = (e.target as HTMLSelectElement).value;
        state.saveAircraft();
      },
    },
    state.aircraft.map((a) => h('option', { value: a.id, selected: a.id === ac.id }, `${a.registration} – ${a.type}`)),
  );

  const fuelOnBoard = r.fuelOnBoard ?? ac.usableFuel;
  const fp = fuelPlan({
    tripFuel: last?.cumFuel ?? 0,
    taxi: Math.round(ac.fuelBurn / 12),
    contingencyPct: 5,
    reserveMin: 30,
    burnPerHour: ac.fuelBurn,
    onBoard: fuelOnBoard,
  });

  el.append(
    fromToSection(),
    section(
      'Rute',
      h('div', { class: 'row' }, routeInput, h('button', { class: 'primary', onclick: applyText }, 'Bruk')),
      h(
        'div',
        { class: 'row wrap' },
        h(
          'button',
          {
            class: isEditMode() ? 'toggle on' : 'toggle',
            onclick: () => {
              setEditMode(!isEditMode());
              toast(isEditMode() ? 'Trykk på kartet for å legge til punkter på slutten av ruten.' : 'Redigering av');
              state.emit('route');
            },
          },
          isEditMode() ? '✎ Redigerer på kart' : '✎ Rediger på kart',
        ),
        h('button', { onclick: () => state.setWaypoints([...wps].reverse()) }, '⇄ Snu'),
        h('button', { onclick: fitRoute }, '⤢ Vis hele'),
        h('button', { onclick: () => confirm('Tømme ruten?') && state.setWaypoints([]) }, 'Tøm'),
      ),
      wps.length ? wpList : h('p', { class: 'muted' }, 'Skriv identer/koordinater over, eller trykk «Rediger på kart». Langt trykk/høyreklikk på kartet gir også valg.'),
    ),
    section(
      'Planlegging',
      h('label', { class: 'field' }, h('span', null, 'Fly'), acSelect),
      h(
        'div',
        { class: 'grid2' },
        numField('Flyhøyde (standard)', r.altitudeFt, (v) => state.setRoute({ altitudeFt: v }), { step: 500, unit: 'ft MSL' }),
        numField('Drivstoff om bord', fuelOnBoard, (v) => state.setRoute({ fuelOnBoard: v }), { unit: ac.fuelUnit }),
        textField('Avgang (lokal tid)', r.departureTime, (v) => state.setRoute({ departureTime: v }), { type: 'datetime-local' }),
        numField('Personer om bord', r.persons, (v) => state.setRoute({ persons: v }), { min: 1, step: 1 }),
      ),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { onclick: setVfrAltitudes, disabled: legs.length === 0 }, '↕ Sett VFR-høyder per legg'),
        wps.some((w) => w.legAltFt != null) ? h('button', { onclick: () => state.setWaypoints(wps.map((w) => ({ ...w, legAltFt: null }))) }, 'Alle legg = standard') : null,
      ),
      h(
        'p',
        { class: 'muted small' },
        `Standardhøyden gjelder alle legg der du ikke har satt egen høyde i navloggen. Vinden hentes i høyden for hvert legg. TAS ${ac.tas} kt · forbruk ${ac.fuelBurn} ${ac.fuelUnit}/t (fra flyprofilen).`,
      ),
    ),
    windSection(dep),
  );

  if (legs.length) {
    el.append(navlogTable(legs, prof, ac.fuelUnit));
    el.append(
      section(
        'Sammendrag',
        h(
          'div',
          { class: 'stats' },
          stat('Distanse', `${fmt.n(last.cumDist, 0)} NM`),
          stat('Tid', fmtMin(last.cumMin)),
          stat('Tur-drivstoff', `${fmt.n(last.cumFuel, 1)} ${ac.fuelUnit}`),
          stat('ETA', last.cumMin !== null ? fmt.time(new Date(dep.getTime() + last.cumMin * 60000)) : '—'),
        ),
        h(
          'table',
          { class: 'mini' },
          h('tbody', null,
            row('Tur', fp.trip, ac.fuelUnit),
            row('Taksing', fp.taxi, ac.fuelUnit),
            row('Uforutsett (5 %)', fp.contingency, ac.fuelUnit),
            row('Reserve (30 min)', fp.reserve, ac.fuelUnit),
            row('Påkrevd', fp.required, ac.fuelUnit, true),
            row('Om bord', fp.onBoard, ac.fuelUnit),
            h('tr', { class: fp.extra < 0 ? 'bad' : 'good' }, h('td', null, 'Ekstra'), h('td', null, `${fmt.n(fp.extra, 1)} ${ac.fuelUnit}`)),
            h('tr', null, h('td', null, 'Utholdenhet'), h('td', null, fmtMin(fp.enduranceMin))),
          ),
        ),
      ),
    );
    const checks = h('ul', { class: 'checks' }, h('li', { class: 'muted' }, 'Sjekker…'));
    el.append(section('VFR-sjekk', checks));
    void vfrChecks(checks, legs, dep, fp.extra, prof);
  }

  el.append(
    section(
      'Lagre og eksportere',
      h(
        'div',
        { class: 'row wrap' },
        textField('Navn', r.name, (v) => state.setRoute({ name: v })),
      ),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { onclick: saveRoute, disabled: wps.length < 2 }, '💾 Lagre'),
        h('button', { onclick: () => download(`${slug(r.name)}.gpx`, routeToGpx(r.name, wps), 'application/gpx+xml'), disabled: wps.length < 2 }, 'GPX'),
        h('button', { onclick: () => download(`${slug(r.name)}.fpl`, routeToFpl(r.name, wps), 'application/xml'), disabled: wps.length < 2 }, 'Garmin .fpl'),
        h('button', { onclick: () => printNavlog(prof), disabled: !legs.length }, '🖨 Navlogg'),
        h('button', { onclick: () => showFpl(el, prof.totalMin ?? 0, fp.enduranceMin), disabled: !legs.length }, 'ICAO-plan'),
      ),
      h(
        'div',
        { class: 'row wrap' },
        simActive()
          ? h('button', { class: 'toggle on', onclick: stopSim }, '■ Stopp simulering')
          : [
              h('button', { onclick: () => startSim(1), disabled: wps.length < 2 }, '▶ Simuler ×1'),
              h('button', { onclick: () => startSim(8), disabled: wps.length < 2 }, '×8'),
              h('button', { onclick: () => startSim(32), disabled: wps.length < 2 }, '×32'),
            ],
      ),
      savedRoutesList(),
    ),
  );
}

const slug = (s: string) => s.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'rute';
const stat = (k: string, v: string) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
const row = (k: string, v: number, unit: string, strong = false) =>
  h('tr', { class: strong ? 'strong' : '' }, h('td', null, k), h('td', null, `${fmt.n(v, 1)} ${unit}`));

function navlogTable(legs: NavlogLeg[], prof: Profile, fuelUnit: string): HTMLElement {
  const ac = state.currentAircraft;
  const pf = perfOf(ac);
  const fc = activeLegWinds();
  const ws = windStatus();
  const manual = state.route.windSpeed > 0;
  const windInfo = fc
    ? h('p', { class: 'small' }, `Vind fra prognose per legg (rettvisende retning/styrke i kt). GS, tid og drivstoff er beregnet med vinden.`)
    : ws.state === 'loading'
      ? h('p', { class: 'small' }, 'Henter vind …')
      : manual
        ? h('p', { class: 'small' }, `Manuell vind ${String(state.route.windDir).padStart(3, '0')}°/${state.route.windSpeed} kt på alle legg.`)
        : h('p', { class: 'warnbox' }, 'Vind mangler – GS, tid og drivstoff under er uten vind. Hent vind under «Vind i marsjhøyden».');
  const kindIcon = { climb: '↗', cruise: '→', descent: '↘' } as const;
  return section(
    'Navigasjonslogg',
    h(
      'p',
      { class: 'small' },
      `Klatring ${pf.climbTas} kt / ${pf.climbFpm} ft/min · marsj TAS ${pf.cruiseTas} kt · nedstigning ${pf.descentTas} kt / ${pf.descentFpm} ft/min til ${PATTERN_AGL} ft over destinasjonen (fra flyprofilen).`,
    ),
    windInfo,
    prof.warnings.length ? h('p', { class: 'warnbox' }, prof.warnings.join(' · ')) : null,
    h(
      'div',
      { class: 'tablewrap' },
      h(
        'table',
        { class: 'navlog' },
        h('thead', null, h('tr', null, ['', 'Til', 'Høyde', 'Vind', 'Temp', 'TC', 'Var', 'MC', 'WCA', 'MH', 'Dist', 'GS', 'ETE', 'Fuel', 'Σ tid'].map((c) => h('th', null, c)))),
        h(
          'tbody',
          null,
          prof.rows.map((r) => {
            const l = legs[r.legIndex];
            const i = r.legIndex;
            return h(
              'tr',
              { class: `pr-${r.kind}` },
              h('td', { class: 'pr-icon', title: r.kind === 'climb' ? 'Klatring' : r.kind === 'descent' ? 'Nedstigning' : 'Marsj' }, kindIcon[r.kind]),
              h('td', { class: r.kind === 'cruise' && r.label === l.to.id ? 'wp-id' : 'pr-label' }, r.label),
              h('td', null, r.kind === 'cruise' ? altCell(i, l) : h('span', { class: 'pr-alt' }, `${r.altFrom}→${r.altTo}`)),
              h('td', { title: windTitle(i), class: 'strong' }, fmtLegWind(i, r.wind)),
              h('td', null, legTemp(i)),
              h('td', null, fmtHdg(r.tc)),
              h('td', null, fmtVar(l.variation)),
              h('td', { class: 'strong' }, fmtHdg(r.mc)),
              h('td', null, r.wca === null ? '—' : `${r.wca > 0 ? '+' : ''}${r.wca.toFixed(0)}`),
              h('td', { class: 'strong' }, r.mh === null ? '—' : fmtHdg(r.mh)),
              h('td', null, r.dist.toFixed(1)),
              h('td', null, fmt.n(r.gs, 0)),
              h('td', null, fmtMin(r.eteMin)),
              h('td', null, fmt.n(r.fuel, 1)),
              h('td', null, fmtMin(r.cumMin)),
            );
          }),
        ),
      ),
    ),
    h(
      'p',
      { class: 'muted small' },
      `↗ klatring, → marsj, ↘ nedstigning. TOC = toppen av klatringen, TOD = start på nedstigningen. Vind (fra, rettvisende/kt) ${activeLegWinds() ? 'fra prognose i leggets høyde' : 'manuelt angitt'}, brukt også under klatring/nedstigning. Distanse i NM, fart i kt, drivstoff i ${fuelUnit}.`,
    ),
  );
}

async function vfrChecks(ul: HTMLElement, legs: NavlogLeg[], dep: Date, extraFuel: number, prof: Profile): Promise<void> {
  const items: HTMLElement[] = [];
  const ok = (t: string) => items.push(h('li', { class: 'ok' }, '✓ ', t));
  const warn = (t: string) => items.push(h('li', { class: 'warn' }, '⚠ ', t));
  const r = state.route;
  const wps = r.waypoints;

  // Halvsirkelregelen
  const high = legs.filter((l) => l.altFt >= 3000);
  const bad = high.filter((l) => !vfrCruiseAltitudeOk(l.mc, l.altFt));
  if (!high.length) ok('Alle legg under 3000 ft – halvsirkelregelen gjelder ikke (husk 3000 ft AGL-grensen).');
  else if (bad.length)
    warn(`Halvsirkelregelen: ${bad.map((l) => `${l.to.id} i ${l.altFt} ft (MC ${fmtHdg(l.mc)}° → ${suggestVfrAltitude(l.mc, l.altFt)} ft)`).join(', ')}. Trykk «Sett VFR-høyder per legg».`);
  else ok('Flyhøydene følger halvsirkelregelen på alle legg');

  // Luftrom langs ruten i marsjhøyden
  const asDb = getAirspaceDb();
  if (asDb) {
    const along = airspacesAlongRoute(asDb, wps, legAltitudes(wps, r.altitudeFt));
    const stale = airspaceStale(asDb.airac, state.db.aipEdition);
    if (!along.length) ok('Ingen kontrollert/spesielt luftrom langs ruten i flyhøydene (utenom start/landing).');
    for (const { airspace: a, atNm, altFt } of along) {
      const li = h(
        'li',
        { class: ['SPORT', 'TIA'].includes(a.kind) ? 'ok' : 'warn' },
        h('span', { class: 'as-dot', style: { background: KIND_STYLE[a.kind].color } }),
        ` ${atNm.toFixed(0)} NM (${altFt} ft): `,
        h('strong', null, a.n),
        ` (${a.c.length === 1 ? `klasse ${a.c}, ` : ''}${fmtLimits(a)}) – ${KIND_ADVICE[a.kind]}`,
        a.f ? ` · ${a.f.replace(/\s*MHZ/i, ' MHz')}` : '',
        a.notam || a.amc ? ' · aktiveres ved NOTAM/AMC' : '',
      );
      items.push(li);
    }
    items.push(
      h(
        'li',
        { class: stale ? 'warn' : 'muted' },
        `Luftromsdata: AIP ${asDb.airac}${stale ? ` – eldre enn gjeldende AIP (${state.db.aipEdition ?? 'ukjent'}), sjekk VFR-kart/AIP` : state.db.aipEdition ? ' (gjeldende utgave)' : ''}. Gjelder marsjhøyden; stig/sink nær flyplasser vurderes ikke.`,
      ),
    );
  }

  // Vind
  if (r.forecast && !activeLegWinds()) warn('Ruten, høyden eller avgangstiden er endret etter at vinden ble hentet – hent prognosevind på nytt.');
  else if (activeLegWinds()) ok(`Prognosevind per legg (hentet ${fmt.time(new Date(r.forecast!.fetchedAt))})`);
  else warn('Navloggen bruker manuell vind – hent prognosevind for en realistisk plan.');

  // Drivstoff
  if (extraFuel < 0) warn(`For lite drivstoff: mangler ${(-extraFuel).toFixed(1)} ${state.currentAircraft.fuelUnit}`);
  else ok('Drivstoff dekker tur + reserve');

  // Dagslys
  const lastLeg = { cumMin: prof.totalMin };
  for (const w of prof.warnings) warn(w);
  const dest = wps[wps.length - 1];
  if (lastLeg.cumMin !== null) {
    const eta = new Date(dep.getTime() + lastLeg.cumMin * 60000);
    const sun = sunTimes(eta, dest.lat, dest.lon);
    if (isNight(dep, wps[0].lat, wps[0].lon) || isNight(eta, dest.lat, dest.lon))
      warn(`Avgang eller ankomst er i mørket (sivil skumring ${fmt.time(sun.civilDusk)} på ${dest.id}). Krever NVFR-rettighet.`);
    else if (sun.sunset && eta.getTime() > sun.sunset.getTime() - 30 * 60000)
      warn(`ETA ${fmt.time(eta)} er under 30 min før solnedgang (${fmt.time(sun.sunset)}) på ${dest.id}`);
    else
      ok(
        sun.polar === 'midnight-sun'
          ? `Midnattssol på ${dest.id}`
          : `Dagslys: ETA ${fmt.time(eta)}, solnedgang ${fmt.time(sun.sunset)} på ${dest.id}`,
      );
  }

  // Vær
  const ids = [...new Set(wps.filter((w) => w.kind === 'airport' && /^[A-Z]{4}$/.test(w.id)).map((w) => w.id))];
  try {
    const metars = await fetchMetars(ids);
    for (const id of ids) {
      const m = metars.find((x) => x.icaoId === id);
      if (!m) continue;
      const cat = categoryOf(m);
      const li = h('li', { class: cat === 'VFR' ? 'ok' : 'warn' }, badge(cat, CATEGORY_COLORS[cat]), ` ${id}: `, h('code', null, m.rawOb));
      items.push(li);
    }
    if (!metars.length) items.push(h('li', { class: 'muted' }, 'Ingen METAR for flyplassene i ruten'));
  } catch (e) {
    items.push(h('li', { class: 'muted' }, wxError(e)));
  }
  items.push(h('li', { class: 'muted' }, 'Husk NOTAM, luftromsstatus og GAMET/LLF på ippc.no / AIM Norge.'));
  clear(ul, items);
}

function saveRoute(): void {
  const r = state.route;
  const existing = state.savedRoutes.find((s) => s.name === r.name);
  const entry = {
    id: existing?.id ?? uid(),
    name: r.name,
    waypoints: r.waypoints,
    altitudeFt: r.altitudeFt,
    windDir: r.windDir,
    windSpeed: r.windSpeed,
    aircraftId: state.currentAircraftId,
    updated: new Date().toISOString(),
  };
  state.savedRoutes = [entry, ...state.savedRoutes.filter((s) => s.id !== entry.id)];
  state.saveRoutes();
  toast(`Lagret «${r.name}»`);
  state.emit('route');
}

function savedRoutesList(): HTMLElement | null {
  if (!state.savedRoutes.length) return null;
  return h(
    'div',
    null,
    h('h4', null, 'Lagrede ruter'),
    h(
      'ul',
      { class: 'list' },
      state.savedRoutes.map((s) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              class: 'link grow',
              onclick: () => {
                state.setRoute({ name: s.name, waypoints: s.waypoints, altitudeFt: s.altitudeFt, windDir: s.windDir, windSpeed: s.windSpeed });
                fitRoute();
              },
            },
            h('strong', null, s.name),
            h('span', { class: 'muted small' }, ` ${s.waypoints.map((w) => w.id).join(' ')}`),
          ),
          h(
            'button',
            {
              title: 'Slett',
              onclick: () => {
                if (!confirm(`Slette «${s.name}»?`)) return;
                state.savedRoutes = state.savedRoutes.filter((x) => x.id !== s.id);
                state.saveRoutes();
                state.emit('route');
              },
            },
            '✕',
          ),
        ),
      ),
    ),
  );
}

function showFpl(el: HTMLElement, eetMin: number, enduranceMin: number): void {
  const r = state.route;
  const eobt = r.departureTime ? new Date(r.departureTime) : new Date(Date.now() + 3600000);
  const text = icaoFlightPlan({
    aircraft: state.currentAircraft,
    waypoints: r.waypoints,
    eobt,
    eetMin,
    enduranceMin,
    altitudeFt: r.altitudeFt,
    tas: state.currentAircraft.tas,
    persons: r.persons,
    alternate: r.alternate || undefined,
  });
  const ta = h('textarea', { class: 'fpl', rows: 8, readonly: true }, text);
  const box = section(
    'ICAO flightplan (utkast)',
    h('p', { class: 'muted small' }, 'Kontroller alle felt og lever planen via den offisielle tjenesten (f.eks. ippc.no). Appen leverer ikke planer selv.'),
    ta,
    h('button', { onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Kopiert')) }, 'Kopier'),
  );
  el.querySelector('.fpl')?.closest('section')?.remove();
  el.append(box);
  box.scrollIntoView({ behavior: 'smooth' });
}

function printNavlog(prof: Profile): void {
  const r = state.route;
  const ac = state.currentAircraft;
  const host = document.getElementById('print')!;
  clear(
    host,
    h('h1', null, r.name),
    h(
      'p',
      null,
      `${ac.registration} (${ac.icaoType}) · TAS ${ac.tas} kt · standardhøyde ${r.altitudeFt} ft · vind ${activeLegWinds() ? `prognose (Open-Meteo, hentet ${fmt.time(new Date(r.forecast!.fetchedAt))})` : `${String(r.windDir).padStart(3, '0')}/${r.windSpeed} kt`} · ${fmt.date(new Date())}`,
    ),
    h(
      'table',
      null,
      h('thead', null, h('tr', null, ['', 'Til', 'Høyde', 'Vind', 'MC', 'MH', 'Dist', 'GS', 'ETE', 'ETA', 'ATA', 'Fuel', 'Frekv./notat'].map((c) => h('th', null, c)))),
      h(
        'tbody',
        null,
        prof.rows.map((l) =>
          h(
            'tr',
            null,
            h('td', null, l.kind === 'climb' ? '↗' : l.kind === 'descent' ? '↘' : ''),
            h('td', null, l.label),
            h('td', null, l.altFrom === l.altTo ? String(l.altTo) : `${l.altFrom}→${l.altTo}`),
            h('td', null, fmtLegWind(l.legIndex, l.wind)),
            h('td', null, fmtHdg(l.mc)),
            h('td', null, l.mh === null ? '' : fmtHdg(l.mh)),
            h('td', null, l.dist.toFixed(1)),
            h('td', null, fmt.n(l.gs, 0)),
            h('td', null, fmtMin(l.eteMin)),
            h('td', null, ''),
            h('td', null, ''),
            h('td', null, fmt.n(l.fuel, 1)),
            h('td', null, ''),
          ),
        ),
      ),
    ),
    h('p', null, `Totalt ${prof.totalDist.toFixed(0)} NM · ${fmtMin(prof.totalMin)} (klatring ${fmtMin(prof.climbMin)}, nedstigning ${fmtMin(prof.descentMin)}) · ${fmt.n(prof.totalFuel, 1)} ${ac.fuelUnit}`),
  );
  if (isNative()) {
    // WKWebView kan ikke skrive ut direkte: del navloggen som HTML (kan skrives ut/lagres fra delingsarket).
    const css = 'body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:6px;font-size:12px}';
    download(`${slug(r.name)}-navlogg.html`, `<!doctype html><meta charset="utf-8"><title>${r.name}</title><style>${css}</style>${host.innerHTML}`, 'text/html');
  } else window.print();
}

/** Vind som retning/styrke, f.eks. «270°/15». Ikke hentet (manuell 0) → «—». */
function fmtLegWind(i: number, w: Wind): string {
  const fc = activeLegWinds()?.[i];
  const manualSet = state.route.windSpeed > 0;
  if (!fc && !manualSet) return '—';
  const ww = fc ?? w;
  const dir = ww.speed < 0.5 ? '000' : fmtHdg(ww.dir);
  return `${dir}°/${Math.round(ww.speed)}`;
}

function legTemp(i: number): string {
  const t = activeLegWinds()?.[i]?.tempC;
  return typeof t === 'number' ? `${Math.round(t)}°` : '—';
}

function windTitle(i: number): string {
  const w = activeLegWinds()?.[i];
  return w ? `Prognose${w.tempC !== null ? `, ${w.tempC.toFixed(0)} °C` : ''}` : 'Manuell vind';
}

function windSection(dep: Date): HTMLElement {
  const r = state.route;
  const active = activeLegWinds(r);
  const stale = r.forecast && !active;
  const ws = windStatus();
  const loading = ws.state === 'loading';
  const btn = h(
    'button',
    { class: 'primary', disabled: r.waypoints.length < 2 || loading, onclick: () => void fetchForecastWind(true) },
    loading ? 'Henter vind …' : active ? '↻ Hent vind på nytt' : '☁ Hent vind fra prognose',
  );
  const temps = active?.map((w) => w?.tempC).filter((t): t is number => typeof t === 'number') ?? [];
  return section(
    'Vind i marsjhøyden',
    h('div', { class: 'row wrap' }, btn, active ? h('button', { onclick: () => state.setRoute({ forecast: null }) }, 'Bruk manuell vind') : null),
    active
      ? h(
          'p',
          { class: 'small' },
          `✓ Prognosevind per legg i flyhøyden for hvert legg, for avgang ${fmt.time(dep)} (hentet ${fmt.time(new Date(r.forecast!.fetchedAt))}).`,
          temps.length ? ` Temperatur i høyden ${fmtRange(temps)} °C.` : '',
        )
      : loading
        ? h('p', { class: 'small' }, '☁ Henter vind og temperatur i marsjhøyden for hvert legg …')
        : ws.state === 'error'
          ? h('p', { class: 'warnbox' }, `Kunne ikke hente vind: ${ws.message}. Prøv igjen, eller legg inn vind manuelt under.`)
          : stale
            ? h('p', { class: 'warnbox' }, 'Ruten, høyden eller avgangstiden er endret – vinden hentes på nytt automatisk.')
            : h('p', { class: 'muted small' }, 'Vind og temperatur hentes automatisk fra værmodell (Open-Meteo) for hvert legg, i marsjhøyden og til tidspunktet du er der. Sett avgangstid for best resultat.'),
    h(
      'div',
      { class: 'grid2' },
      numField('Manuell vind fra (rettv.)', r.windDir, (v) => state.setRoute({ windDir: v }), { step: 10, min: 0, max: 360, unit: '°' }),
      numField('Manuell vindstyrke', r.windSpeed, (v) => state.setRoute({ windSpeed: v }), { unit: 'kt' }),
    ),
    h('p', { class: 'muted small' }, active ? 'Manuell vind brukes bare for legg der prognosen mangler.' : 'Brukes for alle legg til prognosevind er hentet.'),
  );
}


function fmtRange(v: number[]): string {
  const lo = Math.round(Math.min(...v));
  const hi = Math.round(Math.max(...v));
  return lo === hi ? `${lo}` : `${lo} til ${hi}`;
}

// ---------- Fra/Til ----------

/** Valgt avgang/destinasjon før ruten har to punkter. */
let pendingFrom: Waypoint | null = null;
let pendingTo: Waypoint | null = null;

function setFrom(w: Waypoint): void {
  const wps = state.route.waypoints;
  if (wps.length >= 2) return state.setWaypoints([w, ...wps.slice(1)]);
  pendingFrom = w;
  commitPending();
}

function setTo(w: Waypoint): void {
  const wps = state.route.waypoints;
  if (wps.length >= 2) return state.setWaypoints([...wps.slice(0, -1), w]);
  pendingTo = w;
  commitPending();
}

function commitPending(): void {
  if (pendingFrom && pendingTo) {
    state.setWaypoints([pendingFrom, pendingTo]);
    pendingFrom = pendingTo = null;
    fitRoute();
    toast('Rute lagt inn. Dobbelttrykk på rutestreken for å legge inn punkter du kan dra.', 'info', 6000);
  } else {
    state.emit('route');
  }
}

function fromToSection(): HTMLElement {
  const wps = state.route.waypoints;
  const from = wps.length >= 2 ? wps[0] : pendingFrom;
  const to = wps.length >= 2 ? wps[wps.length - 1] : pendingTo;
  return section(
    'Fra og til',
    h('div', { class: 'grid2 fromto' }, airportPicker('Fra (avgang)', from, setFrom), airportPicker('Til (destinasjon)', to, setTo)),
    h(
      'p',
      { class: 'muted small' },
      wps.length >= 2
        ? 'Dobbelttrykk på rutestreken på kartet for å legge inn et punkt, og dra det dit du vil at ruten skal gå. Punkter fester seg til flyplasser og VOR når du slipper dem i nærheten.'
        : 'Velg avgang og destinasjon – søk på ICAO-kode, navn eller sted.',
    ),
  );
}

function airportPicker(label: string, current: Waypoint | null, onPick: (w: Waypoint) => void): HTMLElement {
  const list = h('div', { class: 'suggest', hidden: true });
  const input = h('input', {
    type: 'search',
    value: current ? `${current.id}${current.name ? ` – ${current.name}` : ''}` : '',
    placeholder: 'ICAO, navn eller sted',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    enterkeyhint: 'done',
  });
  let hits: ReturnType<typeof searchAirports> = [];
  const pick = (i: number) => {
    const a = hits[i];
    if (!a) return;
    list.hidden = true;
    input.value = `${a.ident} – ${a.name}`;
    input.blur();
    onPick(airportToWaypoint(a));
  };
  const show = () => {
    const q = input.value.trim();
    hits = q.length >= 2 ? searchAirports(state.db, q, 6) : [];
    clear(
      list,
      hits.map((a, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'suggest-item',
            // pointerdown (ikke click): ellers lukker blur listen før valget registreres.
            onpointerdown: (e: Event) => {
              e.preventDefault();
              pick(i);
            },
          },
          h('strong', null, a.ident),
          ` ${a.name}`,
          h('span', { class: 'muted small' }, ` ${a.city || a.country}`),
        ),
      ),
    );
    list.hidden = !hits.length;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', () => {
    input.select();
    show();
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(0);
    }
  });
  return h('label', { class: 'field picker' }, h('span', null, label), input, list);
}

// ---------- Høyde per legg ----------

/** Redigerbar høyde for et legg; rød om den bryter halvsirkelregelen. */
function altCell(i: number, l: NavlogLeg): HTMLElement {
  const wps = state.route.waypoints;
  const custom = wps[i + 1]?.legAltFt != null;
  const wrong = l.altFt >= 3000 && !vfrCruiseAltitudeOk(l.mc, l.altFt);
  return h('input', {
    type: 'number',
    inputmode: 'numeric',
    step: 500,
    min: 0,
    class: `alt-input${custom ? ' custom' : ''}${wrong ? ' wrong' : ''}`,
    value: l.altFt,
    title: wrong ? `Halvsirkelregelen: bruk ${suggestVfrAltitude(l.mc, l.altFt)} ft (MC ${fmtHdg(l.mc)}°)` : custom ? 'Egen høyde for dette legget' : 'Standardhøyde',
    onchange: (e: Event) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      const next = [...state.route.waypoints];
      next[i + 1] = { ...next[i + 1], legAltFt: Number.isFinite(v) && v !== state.route.altitudeFt ? v : null };
      state.setWaypoints(next);
    },
  });
}

/** Gir hvert legg nærmeste korrekte VFR-høyde (halvsirkelregelen) på eller over standardhøyden. */
function setVfrAltitudes(): void {
  const r = state.route;
  const legs = computeNavlog(r.waypoints, { tas: state.currentAircraft.tas, wind: { dir: 0, speed: 0 }, fuelBurn: 0, altitudeFt: r.altitudeFt });
  const base = Math.max(3500, r.altitudeFt);
  const next = r.waypoints.map((w, i) => {
    if (i === 0) return w;
    const alt = suggestVfrAltitude(legs[i - 1].mc, base - 500);
    return { ...w, legAltFt: alt === r.altitudeFt ? null : alt };
  });
  state.setWaypoints(next);
  toast('VFR-høyder satt per legg – vinden hentes for de nye høydene');
}
