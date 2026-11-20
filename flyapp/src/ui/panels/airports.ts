import { AIRPORT_TYPE_TEXT, ftToM, nearestAirports, searchAirports, type Airport, type AipPhone } from '../../lib/data';
import { bearingTrue, distanceNm, fmtHdg, formatLatLon } from '../../lib/geo';
import { declination, fmtVar, trueToMag } from '../../lib/mag';
import { categoryOf, CATEGORY_COLORS, CATEGORY_TEXT, decodeMetar, fetchMetars, fetchTafs, metarAgeMin, wxError } from '../../lib/metar';
import { windComponents } from '../../lib/navlog';
import { fmtDeg, runwayEnds } from '../../lib/runway';
import { runwayDiagram } from '../rwydiagram';
import { sunTimes } from '../../lib/sun';
import { badge, clear, fmt, h, section, tafView } from '../dom';
import { addRoutePoint, AIRPORT_COLORS, flyTo, map } from '../map';
import { directTo } from '../position';
import { airportToWaypoint, state } from '../state';

let query = '';

export function renderAirports(el: HTMLElement): void {
  if (state.selectedAirport) return renderAirportDetail(el, state.selectedAirport);

  const results = h('div');
  const input = h('input', {
    type: 'search',
    placeholder: 'Søk ident, navn eller sted …',
    value: query,
    autocapitalize: 'characters',
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value;
      draw();
    },
  });
  const draw = () => {
    const ref = state.position ?? (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : { lat: 60, lon: 10 });
    const list = query.trim()
      ? searchAirports(state.db, query).map((a) => ({ airport: a, dist: distanceNm(ref, a) }))
      : nearestAirports(state.db, ref, 25);
    clear(
      results,
      h('h3', null, query.trim() ? 'Treff' : state.position ? 'Nærmeste (fra din posisjon)' : 'Nærmeste (fra kartets midtpunkt)'),
      h(
        'ul',
        { class: 'list' },
        list.map(({ airport: a, dist }) =>
          h(
            'li',
            null,
            h(
              'button',
              { class: 'link grow', onclick: () => state.selectAirport(a) },
              h('span', { class: 'dot', style: { background: a.towered ? AIRPORT_COLORS.towered : AIRPORT_COLORS.untowered } }),
              h('strong', null, a.ident),
              ' ',
              h('span', null, a.name),
              h('span', { class: 'muted small' }, ` · ${a.city || a.country}`),
            ),
            h(
              'span',
              { class: 'muted small nowrap' },
              `${dist.toFixed(0)} NM ${fmtHdg(trueToMag(bearingTrue(ref, a), declination(ref)))}°`,
            ),
            h('button', { title: 'Direkte til', onclick: () => directTo(airportToWaypoint(a)) }, '→'),
          ),
        ),
      ),
    );
  };
  el.append(h('div', { class: 'card' }, input, results));
  draw();
  setTimeout(() => input.focus({ preventScroll: true }), 50);
}

function renderAirportDetail(el: HTMLElement, a: Airport): void {
  const decl = declination(a);
  const sun = sunTimes(new Date(), a.lat, a.lon);
  const wxBox = h('div', null, h('p', { class: 'muted' }, 'Henter vær …'));
  const rwyBody = h('tbody');

  const diagram = h('div', { class: 'rwy-diagram-wrap' });
  const drawRunways = (wind: { dir: number; speed: number } | null) => {
    const svg = runwayDiagram(a, decl, wind);
    clear(diagram, svg ?? '', svg ? h('div', { class: 'muted small' }, `Banene sett ovenfra, nord opp${wind ? ` · vind fra ${fmtDeg(wind.dir)} rettvisende, ${wind.speed} kt (METAR)` : ''}. Retninger i grader magnetisk (misvisning ${fmtVar(decl)}).`) : '');
    drawRunwayRows(wind);
  };
  const drawRunwayRows = (wind: { dir: number; speed: number } | null) =>
    clear(
      rwyBody,
      a.runways.map((r) => {
        const comps = (ident: string, hdgTrue: number | null) => {
          if (!wind || hdgTrue === null) return '';
          const c = windComponents(hdgTrue, wind);
          const hw = c.head >= 0 ? `↓${c.head.toFixed(0)}` : `↑${(-c.head).toFixed(0)}`;
          return `${ident}: ${hw} ${Math.abs(c.cross).toFixed(0)}${c.cross >= 0 ? '→' : '←'}`;
        };
        const [e1, e2] = runwayEnds(r, decl);
        const leHdg = e1.trueHdg;
        const heHdg = e2.trueHdg;
        return h(
          'tr',
          null,
          h('td', { class: 'strong' }, `${r.le}/${r.he}`),
          h('td', null, [`${r.le}: ${fmtDeg(e1.magHdg)}`, h('br'), `${r.he}: ${fmtDeg(e2.magHdg)}`]),
          h('td', null, r.lengthFt ? `${ftToM(r.lengthFt)} m` : '—'),
          h('td', null, r.widthFt ? `${ftToM(r.widthFt)} m` : '—'),
          h('td', null, r.surface || '—'),
          h('td', null, r.lighted ? 'Ja' : 'Nei'),
          h('td', { class: 'small' }, [comps(r.le, leHdg), h('br'), comps(r.he, heHdg)]),
        );
      }),
    );
  drawRunways(null);

  el.append(
    h(
      'div',
      { class: 'card' },
      h('button', { class: 'link', onclick: () => state.selectAirport(null) }, '‹ Tilbake'),
      h('h2', { class: 'ap-title' }, `${a.ident}${a.iata ? ` / ${a.iata}` : ''}`),
      h('div', null, a.name),
      h(
        'div',
        { class: 'muted small' },
        `${AIRPORT_TYPE_TEXT[a.type]} · ${a.city ? a.city + ', ' : ''}${a.country} · ${a.towered ? 'Kontrollert (TWR)' : 'Ukontrollert/AFIS'}`,
      ),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'primary', onclick: () => directTo(airportToWaypoint(a)) }, 'Direkte til'),
        h('button', { onclick: () => addRoutePoint(airportToWaypoint(a)) }, '+ Legg til i rute'),
        h('button', { onclick: () => flyTo(a, 12) }, 'Vis på kart'),
      ),
    ),
    section(
      'Fakta',
      h(
        'table',
        { class: 'mini' },
        h(
          'tbody',
          null,
          tr('Høyde', `${a.elevFt ?? '—'} ft (${ftToM(a.elevFt) ?? '—'} m)`),
          tr('Posisjon', formatLatLon(a)),
          tr('Misvisning', fmtVar(decl)),
          tr(
            'Sol i dag',
            sun.polar === 'midnight-sun'
              ? 'Midnattssol'
              : sun.polar === 'polar-night'
                ? 'Mørketid'
                : `Opp ${fmt.time(sun.sunrise)} · ned ${fmt.time(sun.sunset)}`,
          ),
          tr('Sivil skumring', sun.civilPolar === 'normal' ? `${fmt.time(sun.civilDawn)} – ${fmt.time(sun.civilDusk)}` : sun.civilPolar === 'always-light' ? 'Lyst hele døgnet' : 'Mørkt hele døgnet'),
          state.position ? tr('Fra deg', `${distanceNm(state.position, a).toFixed(1)} NM, ${fmtHdg(trueToMag(bearingTrue(state.position, a), decl))}°M`) : null,
        ),
      ),
    ),
    phoneSection(a) ?? '',
    section('Vær', wxBox),
    section(
      'Rullebaner',
      diagram,
      a.runways.length
        ? h(
            'div',
            { class: 'tablewrap' },
            h('table', { class: 'mini' }, h('thead', null, h('tr', null, ['Bane', 'Retning (°M)', 'Lengde', 'Bredde', 'Dekke', 'Lys', 'Vind (mot/side)'].map((c) => h('th', null, c)))), rwyBody),
          )
        : h('p', { class: 'muted' }, 'Ingen baneinformasjon'),
    ),
    section(
      'Frekvenser',
      a.freqs.length
        ? h(
            'table',
            { class: 'mini' },
            h(
              'tbody',
              null,
              a.freqs.map((f) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'muted' }, f.type),
                  h('td', { class: 'strong' }, f.mhz?.toFixed(3) ?? '—'),
                  h('td', { class: 'small' }, [f.hr, f.desc && f.desc !== f.type ? f.desc : ''].filter(Boolean).join(' · ')),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Ingen frekvenser i databasen – sjekk AIP.'),
      h(
        'p',
        { class: a.freqSource === 'AIP' ? 'muted small' : 'warnbox' },
        a.freqSource === 'AIP'
          ? `Frekvenser fra AIP Norge (utgave ${state.db.aipEdition ?? '?'}), AD 2.18. Kontroller alltid mot gjeldende AIP og NOTAM.`
          : 'Frekvenser fra OurAirports (brukerbidrag) – kan være utdatert. Flyplassen står ikke i AIP Norge AD 2; sjekk lokale opplysninger.',
      ),
    ),
  );

  if (/^[A-Z]{4}$/.test(a.ident)) {
    Promise.all([fetchMetars([a.ident]), fetchTafs([a.ident])])
      .then(([metars, tafs]) => {
        const m = metars[0];
        const t = tafs[0];
        if (m && typeof m.wdir === 'number' && m.wspd !== null) drawRunways({ dir: m.wdir, speed: m.wspd });
        clear(
          wxBox,
          m
            ? [
                h('div', null, badge(categoryOf(m), CATEGORY_COLORS[categoryOf(m)]), ' ', h('span', { class: 'muted small' }, `${CATEGORY_TEXT[categoryOf(m)]} · ${metarAgeMin(m)} min gammel`)),
                h('pre', { class: 'raw' }, m.rawOb),
                h('ul', { class: 'decoded' }, decodeMetar(m).map((s) => h('li', null, s))),
              ]
            : h('p', { class: 'muted' }, 'Ingen METAR for denne flyplassen.'),
          tafView(t?.rawTAF),
        );
      })
      .catch((e) => clear(wxBox, h('p', { class: 'muted' }, wxError(e))));
  } else clear(wxBox, h('p', { class: 'muted' }, 'Ingen ICAO-kode, ingen METAR.'));
}

/** Tittel for et AIP-telefonnummer ut fra typen og teksten rundt. */
function phoneTitle(p: AipPhone, a: Airport): string {
  if (p.kind === 'atc') {
    if (/supervisor/i.test(p.label)) return 'ATC supervisor';
    if (/AFIS/i.test(p.label)) return 'AFIS';
    if (/\b(TWR|Tower)\b/i.test(p.label)) return 'Tårn (TWR)';
    if (/\bATS\b/i.test(p.label)) return 'ATS / tårn';
    return a.towered ? 'Tårn / ATC' : 'AFIS / ATS';
  }
  if (p.kind === 'ppr') return 'PPR';
  if (p.kind === 'met') return 'Værvarsling (MWO)';
  if (p.kind === 'admin') return /sentralbord|switchboard/i.test(p.label) ? 'Sentralbord' : /\bMIL\b/.test(p.label) ? 'Militær vakt' : 'Flyplassen (administrasjon)';
  return p.label.replace(/^…/, '').slice(0, 60);
}

function phoneSection(a: Airport): HTMLElement | null {
  if (!a.phones?.length) return null;
  const main = a.phones.filter((p) => p.kind !== 'other');
  const rest = a.phones.filter((p) => p.kind === 'other');
  const row = (p: AipPhone) =>
    h(
      'a',
      { class: `tel-row tel-${p.kind}`, href: `tel:${p.tel.replace(/\s/g, '')}` },
      h('span', { class: 'tel-title' }, phoneTitle(p, a)),
      h('span', { class: 'tel-num' }, `📞 ${p.tel}`),
      (p.kind === 'atc' || p.kind === 'ppr') && p.label && p.label !== 'Telefon' ? h('span', { class: 'tel-ctx muted small' }, `AIP: «${p.label}»`) : null,
    );
  return section(
    'Telefon (AIP)',
    main.length ? h('div', { class: 'tel-list' }, main.map(row)) : h('p', { class: 'muted small' }, 'Ingen tårn-/AFIS-nummer funnet i AIP for denne flyplassen.'),
    rest.length ? h('details', null, h('summary', { class: 'muted' }, `Flere numre (${rest.length}): handling, drivstoff, parkering …`), h('div', { class: 'tel-list' }, rest.map(row))) : null,
    h('p', { class: 'muted small' }, `Hentet fra AIP Norge AD 2 (${state.db.aipEdition ?? ''}). Trykk for å ringe. Sjekk alltid gjeldende AIP.`),
  );
}

const tr = (k: string, v: string) => h('tr', null, h('td', { class: 'muted' }, k), h('td', null, v));

