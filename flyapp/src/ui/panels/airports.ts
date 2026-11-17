import { AIRPORT_TYPE_TEXT, ftToM, nearestAirports, searchAirports, type Airport } from '../../lib/data';
import { bearingTrue, distanceNm, fmtHdg, formatLatLon, norm360 } from '../../lib/geo';
import { declination, fmtVar, trueToMag } from '../../lib/mag';
import { categoryOf, CATEGORY_COLORS, CATEGORY_TEXT, decodeMetar, fetchMetars, fetchTafs, metarAgeMin } from '../../lib/metar';
import { windComponents } from '../../lib/navlog';
import { sunTimes } from '../../lib/sun';
import { badge, clear, fmt, h, section } from '../dom';
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

  const drawRunways = (wind: { dir: number; speed: number } | null) =>
    clear(
      rwyBody,
      a.runways.map((r) => {
        const comps = (ident: string, hdgTrue: number | null) => {
          if (!wind || hdgTrue === null) return '';
          const c = windComponents(hdgTrue, wind);
          const hw = c.head >= 0 ? `↓${c.head.toFixed(0)}` : `↑${(-c.head).toFixed(0)}`;
          return `${ident}: ${hw} ${Math.abs(c.cross).toFixed(0)}${c.cross >= 0 ? '→' : '←'}`;
        };
        const leHdg = r.leHeadingTrue ?? identHeading(r.le, decl);
        const heHdg = leHdg !== null ? norm360(leHdg + 180) : identHeading(r.he, decl);
        return h(
          'tr',
          null,
          h('td', { class: 'strong' }, `${r.le}/${r.he}`),
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
    section('Vær', wxBox),
    section(
      'Rullebaner',
      a.runways.length
        ? h(
            'div',
            { class: 'tablewrap' },
            h('table', { class: 'mini' }, h('thead', null, h('tr', null, ['Bane', 'Lengde', 'Bredde', 'Dekke', 'Lys', 'Vind (mot/side)'].map((c) => h('th', null, c)))), rwyBody),
          )
        : h('p', { class: 'muted' }, 'Ingen baneinformasjon'),
    ),
    section(
      'Frekvenser',
      a.freqs.length
        ? h(
            'table',
            { class: 'mini' },
            h('tbody', null, a.freqs.map((f) => tr(f.type, `${f.mhz?.toFixed(3) ?? '—'} ${f.desc && f.desc !== f.type ? `(${f.desc})` : ''}`))),
          )
        : h('p', { class: 'muted' }, 'Ingen frekvenser i databasen – sjekk AIP.'),
      h('p', { class: 'muted small' }, 'Data fra OurAirports. Kontroller alltid mot gjeldende AIP/VFR-kart.'),
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
          t ? [h('h4', null, 'TAF'), h('pre', { class: 'raw' }, t.rawTAF)] : null,
        );
      })
      .catch(() => clear(wxBox, h('p', { class: 'muted' }, 'Kunne ikke hente vær (offline?).')));
  } else clear(wxBox, h('p', { class: 'muted' }, 'Ingen ICAO-kode, ingen METAR.'));
}

const tr = (k: string, v: string) => h('tr', null, h('td', { class: 'muted' }, k), h('td', null, v));

/** Banenummer → rettvisende retning (09 → 090°M → true). */
function identHeading(ident: string, decl: number): number | null {
  const m = ident.match(/^(\d{1,2})/);
  return m ? norm360(+m[1] * 10 + decl) : null;
}
