import { categoryOf, CATEGORY_COLORS, CATEGORY_TEXT, decodeMetar, fetchMetars, fetchTafs, metarAgeMin, type FlightCategory, wxError } from '../../lib/metar';
import { load, save } from '../../lib/store';
import { badge, clear, h, section, toast } from '../dom';
import { state } from '../state';

let favourites: string[] = load('wxFavourites', ['ENGM', 'ENBR', 'ENZV', 'ENVA']);

export function renderWeather(el: HTMLElement): void {
  const routeIds = [...new Set(state.route.waypoints.filter((w) => w.kind === 'airport' && /^[A-Z]{4}$/.test(w.id)).map((w) => w.id))];
  const ids = [...new Set([...routeIds, ...favourites])];
  const list = h('div', null, h('p', { class: 'muted' }, 'Henter METAR/TAF …'));
  const input = h('input', { type: 'text', placeholder: 'Legg til ICAO, f.eks. ENTO', autocapitalize: 'characters', maxlength: 4 });
  const add = () => {
    const id = input.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(id)) return toast('Skriv en firebokstavs ICAO-kode', 'warn');
    favourites = [...new Set([id, ...favourites])];
    save('wxFavourites', favourites);
    state.emit('route');
  };

  el.append(
    section(
      'Vær',
      h('div', { class: 'row' }, input, h('button', { class: 'primary', onclick: add }, 'Legg til')),
      h(
        'div',
        { class: 'legend' },
        (Object.keys(CATEGORY_COLORS) as FlightCategory[]).filter((c) => c !== 'UNK').map((c) => h('span', { title: CATEGORY_TEXT[c] }, badge(c, CATEGORY_COLORS[c]))),
      ),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: state.settings.showMetars, onchange: (e: Event) => state.updateSettings({ showMetars: (e.target as HTMLInputElement).checked }) }),
        ' Vis METAR-farger på kartet',
      ),
    ),
    list,
    section(
      'Mer vær og briefing',
      h(
        'ul',
        { class: 'links' },
        link('https://www.ippc.no/', 'IPPC (Avinor): NOTAM, GAMET, LLF, flightplan'),
        link('https://www.yr.no/', 'Yr – lokalvarsel'),
        link('https://aviationweather.gov/', 'AviationWeather.gov – globale kart, SIGMET'),
        link('https://www.windy.com/', 'Windy – vind i høyden'),
      ),
      h('p', { class: 'muted small' }, 'METAR/TAF: aviationweather.gov. Appen erstatter ikke en offisiell værbriefing.'),
    ),
  );

  Promise.all([fetchMetars(ids), fetchTafs(ids)])
    .then(([metars, tafs]) => {
      clear(
        list,
        ids.map((id) => {
          const m = metars.find((x) => x.icaoId === id);
          const t = tafs.find((x) => x.icaoId === id);
          const cat = m ? categoryOf(m) : 'UNK';
          return h(
            'section',
            { class: 'card wx', style: { borderLeftColor: CATEGORY_COLORS[cat] } },
            h(
              'div',
              { class: 'row' },
              h(
                'button',
                {
                  class: 'link grow',
                  onclick: () => {
                    const a = state.db.byIdent.get(id);
                    if (a) state.selectAirport(a), document.dispatchEvent(new CustomEvent('open-panel', { detail: 'airports' }));
                  },
                },
                h('strong', null, id),
                ' ',
                h('span', { class: 'muted small' }, state.db.byIdent.get(id)?.name ?? ''),
              ),
              badge(cat, CATEGORY_COLORS[cat]),
              routeIds.includes(id) ? h('span', { class: 'muted small' }, ' rute') : null,
              favourites.includes(id)
                ? h(
                    'button',
                    {
                      title: 'Fjern',
                      onclick: () => {
                        favourites = favourites.filter((f) => f !== id);
                        save('wxFavourites', favourites);
                        state.emit('route');
                      },
                    },
                    '✕',
                  )
                : null,
            ),
            m ? [h('pre', { class: 'raw' }, m.rawOb), h('div', { class: 'muted small' }, `${metarAgeMin(m)} min gammel · ${decodeMetar(m).join(' · ')}`)] : h('p', { class: 'muted small' }, 'Ingen METAR'),
            t ? h('details', null, h('summary', null, 'TAF'), h('pre', { class: 'raw' }, t.rawTAF)) : null,
          );
        }),
      );
    })
    .catch((e) => clear(list, h('p', { class: 'muted' }, wxError(e))));
}

const link = (href: string, text: string) => h('li', null, h('a', { href, target: '_blank', rel: 'noopener' }, text));
