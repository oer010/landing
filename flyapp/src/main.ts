import './style.css';
import { loadDb } from './lib/data';
import { setAirportLookup } from './lib/metar';
import { clear, h, toast } from './ui/dom';
import { initDatabar } from './ui/databar';
import { fitRoute, initMap, map } from './ui/map';
import { cancelDirectTo, gpsActive, simActive, startGps, startRecording, stopGps, stopRecording, stopSim } from './ui/position';
import { state } from './ui/state';
import { initNativeChrome, isNative, setKeepAwake } from './lib/platform';
import { renderRoute } from './ui/panels/route';
import { renderAirports } from './ui/panels/airports';
import { renderWeather } from './ui/panels/weather';
import { renderAircraft } from './ui/panels/aircraft';
import { renderTools } from './ui/panels/tools';
import { renderLogbook } from './ui/panels/logbook';
import { renderChecklists } from './ui/panels/checklists';
import { renderSettings } from './ui/panels/settings';

type PanelId = 'route' | 'airports' | 'weather' | 'aircraft' | 'tools' | 'logbook' | 'checklists' | 'settings';

const PANELS: Record<PanelId, { title: string; tab: string; icon: string; render: (el: HTMLElement) => void; events: Parameters<typeof state.on>[0][] }> = {
  route: { title: 'Rute og navlogg', tab: 'Rute', icon: '⟋', render: renderRoute, events: ['route', 'aircraft', 'airspace'] },
  airports: { title: 'Flyplasser', tab: 'Plasser', icon: '◎', render: renderAirports, events: ['select'] },
  weather: { title: 'Vær', tab: 'Vær', icon: '☁', render: renderWeather, events: ['route'] },
  aircraft: { title: 'Fly, masse og balanse', tab: 'Fly', icon: '✈', render: renderAircraft, events: ['aircraft'] },
  tools: { title: 'E6B og verktøy', tab: 'E6B', icon: '⊕', render: renderTools, events: [] },
  logbook: { title: 'Spor og loggbok', tab: 'Logg', icon: '☰', render: renderLogbook, events: ['tracks', 'logbook'] },
  checklists: { title: 'Sjekklister', tab: 'Sjekk', icon: '✓', render: renderChecklists, events: ['checklists'] },
  settings: { title: 'Innstillinger', tab: 'Mer', icon: '⚙', render: renderSettings, events: ['settings', 'airspace'] },
};

let openPanel: PanelId | null = null;
let unsub: (() => void)[] = [];

function showPanel(id: PanelId | null): void {
  const panel = document.getElementById('panel')!;
  const body = panel.querySelector<HTMLElement>('.panel-body')!;
  unsub.forEach((u) => u());
  unsub = [];
  openPanel = id;
  document.querySelectorAll<HTMLButtonElement>('#tabs button[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  document.body.classList.toggle('panel-open', id !== null);
  if (!id) {
    panel.hidden = true;
    setTimeout(() => map.invalidateSize(), 250);
    return;
  }
  const def = PANELS[id];
  panel.hidden = false;
  panel.querySelector('h2')!.textContent = def.title;
  const draw = () => {
    const scroll = body.scrollTop;
    // Ikke tegn på nytt mens brukeren skriver i et felt i panelet.
    const active = document.activeElement;
    if (active && body.contains(active) && active.matches('input[type=text],input[type=search],textarea') && active !== body) {
      pending = true;
      return;
    }
    clear(body);
    def.render(body);
    body.scrollTop = scroll;
  };
  let pending = false;
  const onFocusOut = () => {
    if (pending) {
      pending = false;
      setTimeout(draw, 0);
    }
  };
  body.addEventListener('focusout', onFocusOut);
  unsub.push(() => body.removeEventListener('focusout', onFocusOut));
  unsub.push(...def.events.map((e) => state.on(e, draw)));
  clear(body);
  body.scrollTop = 0;
  def.render(body);
  setTimeout(() => map.invalidateSize(), 250);
}

function mapButtons(): HTMLElement {
  const gpsBtn = h('button', { class: 'fab', title: 'GPS av/på' }, 'GPS');
  const followBtn = h('button', { class: 'fab', title: 'Følg flyet / vis ruten' }, 'Følg');
  const recBtn = h('button', { class: 'fab rec', title: 'Sporlogging av/på' }, 'REC');
  const dtoBtn = h('button', { class: 'fab dto', title: 'Avbryt direkte til', hidden: true }, 'D→ ✕');
  const simBtn = h('button', { class: 'fab sim', title: 'Stopp simulering', hidden: true }, 'SIM ■');
  gpsBtn.onclick = () => (gpsActive() ? stopGps() : startGps());
  followBtn.onclick = () => {
    state.following = !state.following;
    if (state.following && state.position) map.panTo([state.position.lat, state.position.lon]);
    else if (!state.position) fitRoute();
    state.emit('nav');
  };
  recBtn.onclick = () => {
    if (state.recording) {
      stopRecording();
    } else {
      if (!gpsActive() && !simActive()) startGps();
      startRecording();
    }
  };
  dtoBtn.onclick = cancelDirectTo;
  simBtn.onclick = stopSim;
  const update = () => {
    gpsBtn.classList.toggle('on', gpsActive());
    followBtn.classList.toggle('on', state.following && !!state.position);
    recBtn.classList.toggle('on', !!state.recording);
    dtoBtn.hidden = !state.directTo;
    simBtn.hidden = !simActive();
  };
  state.on('nav', update);
  update();
  return h('div', { class: 'fabs' }, gpsBtn, followBtn, recBtn, dtoBtn, simBtn);
}

function disclaimer(): void {
  if (state.settings.disclaimerAccepted) return;
  const dlg = h(
    'dialog',
    { class: 'disclaimer' },
    h('h2', null, 'VFR Flyapp'),
    h(
      'p',
      null,
      'Denne appen er et hjelpemiddel for planlegging og situasjonsforståelse under VFR-flyging. Den er ',
      h('strong', null, 'ikke godkjent for navigasjon'),
      '. Kart, flyplass- og værdata kan være feil eller utdaterte.',
    ),
    h('p', null, 'Fartøysjefen er alltid ansvarlig for å bruke gjeldende AIP, VFR-kart, NOTAM og offisiell værbriefing.'),
    h(
      'button',
      {
        class: 'primary',
        onclick: () => {
          state.updateSettings({ disclaimerAccepted: true });
          dlg.close();
          dlg.remove();
        },
      },
      'Jeg forstår',
    ),
  );
  document.body.append(dlg);
  dlg.showModal();
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const tabs = h(
    'nav',
    { id: 'tabs' },
    h('button', { 'data-panel': 'map', class: 'active-map', onclick: () => showPanel(null) }, h('span', { class: 'ico' }, '⌖'), 'Kart'),
    (Object.keys(PANELS) as PanelId[]).map((id) =>
      h('button', { 'data-panel': id, onclick: () => showPanel(openPanel === id ? null : id) }, h('span', { class: 'ico' }, PANELS[id].icon), PANELS[id].tab),
    ),
  );
  const panel = h(
    'section',
    { id: 'panel', hidden: true },
    h('header', null, h('h2'), h('button', { class: 'close', title: 'Lukk', onclick: () => showPanel(null) }, '✕')),
    h('div', { class: 'panel-body' }),
  );
  const mapEl = h('div', { id: 'map' });
  const databar = h('header', { id: 'databar' });
  clear(app, databar, h('main', { id: 'main' }, mapEl, panel, mapButtons()), tabs);

  initDatabar(databar);
  try {
    state.db = await loadDb();
  } catch (e) {
    toast(String((e as Error).message), 'error', 10000);
    state.db = { airports: [], navaids: [], byIdent: new Map(), navaidsByIdent: new Map(), generated: new Date().toISOString(), region: '–' };
  }
  setAirportLookup((id) => state.db.byIdent.get(id));
  initMap(mapEl);
  document.getElementById('loading')?.remove();

  state.on('select', () => {
    if (state.selectedAirport && openPanel !== 'airports') showPanel('airports');
  });
  document.addEventListener('open-panel', (e) => showPanel((e as CustomEvent<PanelId>).detail));
  disclaimer();

  void initNativeChrome();
  if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }
  // Hold skjermen våken mens GPS eller simulering er aktiv.
  let awake = false;
  const syncAwake = () => {
    const want = gpsActive() || simActive();
    if (want === awake) return;
    awake = want;
    setKeepAwake(want).catch(() => (awake = false));
  };
  state.on('nav', syncAwake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && awake) setKeepAwake(true).catch(() => undefined);
  });
  window.addEventListener('online', () => toast('Tilkoblet igjen'));
  window.addEventListener('offline', () => toast('Frakoblet – bruker lagrede data', 'warn'));
}

void main();
