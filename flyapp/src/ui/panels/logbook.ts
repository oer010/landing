import { distanceNm } from '../../lib/geo';
import { download, trackToGpx } from '../../lib/export';
import { fmtMin } from '../../lib/navlog';
import { isNight } from '../../lib/sun';
import { uid, type LogEntry, type Track } from '../../lib/store';
import { fmt, h, numField, section, textField, toast } from '../dom';
import { showTrack } from '../map';
import { startRecording, stopRecording } from '../position';
import { state } from '../state';

export function renderLogbook(el: HTMLElement): void {
  const total = state.logbook.reduce((s, e) => s + e.blockMin, 0);
  const landings = state.logbook.reduce((s, e) => s + e.landings, 0);
  const since90 = Date.now() - 90 * 86400000;
  const recent = state.logbook.filter((e) => new Date(e.date).getTime() >= since90).reduce((s, e) => s + e.landings, 0);

  el.append(
    section(
      'Sporlogging',
      state.recording
        ? h('button', { class: 'toggle on', onclick: () => finishRecording() }, `■ Stopp logging (${state.recording.points.length} punkter)`)
        : h('button', { class: 'primary', onclick: startRecording }, '● Start logging'),
      h('p', { class: 'muted small' }, 'Sporet lagres lokalt og kan eksporteres som GPX. GPS må være på (eller simulering).'),
      state.tracks.length
        ? h(
            'ul',
            { class: 'list' },
            state.tracks.map((t) =>
              h(
                'li',
                null,
                h('button', { class: 'link grow', onclick: () => showTrack(t.id) }, h('strong', null, t.name), h('span', { class: 'muted small' }, ` ${fmt.date(new Date(t.started))} · ${trackStats(t)}`)),
                h('button', { title: 'Loggfør', onclick: () => logFromTrack(t) }, '📒'),
                h('button', { title: 'GPX', onclick: () => download(`${t.name.replace(/\W+/g, '_')}.gpx`, trackToGpx(t), 'application/gpx+xml') }, 'GPX'),
                h(
                  'button',
                  {
                    title: 'Slett',
                    onclick: () => {
                      if (!confirm(`Slette sporet «${t.name}»?`)) return;
                      state.tracks = state.tracks.filter((x) => x.id !== t.id);
                      state.saveTracks();
                      showTrack(null);
                    },
                  },
                  '✕',
                ),
              ),
            ),
          )
        : null,
    ),
    section(
      'Loggbok',
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Total tid'), h('span', { class: 'v' }, fmtMin(total))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Landinger'), h('span', { class: 'v' }, String(landings))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Landinger 90 d'), h('span', { class: 'v' + (recent < 3 ? ' warn' : '') }, String(recent))),
      ),
      recent < 3 ? h('p', { class: 'warnbox' }, 'Under 3 landinger siste 90 dager – du kan ikke ta med passasjerer (FCL.060).') : null,
      entryForm(),
      state.logbook.length
        ? h(
            'div',
            { class: 'tablewrap' },
            h(
              'table',
              { class: 'mini' },
              h('thead', null, h('tr', null, ['Dato', 'Fly', 'Fra', 'Til', 'Tid', 'Ldg', 'Natt', ''].map((c) => h('th', null, c)))),
              h(
                'tbody',
                null,
                state.logbook.map((e) =>
                  h(
                    'tr',
                    { title: e.remarks },
                    h('td', null, e.date),
                    h('td', null, e.aircraft),
                    h('td', null, e.from),
                    h('td', null, e.to),
                    h('td', null, fmtMin(e.blockMin)),
                    h('td', null, String(e.landings)),
                    h('td', null, e.night ? 'Ja' : ''),
                    h(
                      'td',
                      null,
                      h(
                        'button',
                        {
                          onclick: () => {
                            if (!confirm('Slette føringen?')) return;
                            state.logbook = state.logbook.filter((x) => x.id !== e.id);
                            state.saveLogbook();
                          },
                        },
                        '✕',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Ingen føringer ennå.'),
      state.logbook.length ? h('button', { onclick: exportCsv }, 'Eksporter CSV') : null,
    ),
  );
}

function trackStats(t: Track): string {
  let d = 0;
  for (let i = 1; i < t.points.length; i++) d += distanceNm(t.points[i - 1], t.points[i]);
  const min = t.points.length ? (t.points[t.points.length - 1].t - t.points[0].t) / 60000 : 0;
  return `${d.toFixed(0)} NM · ${fmtMin(min)}`;
}

function finishRecording(): void {
  const t = stopRecording();
  if (t && confirm('Lage en loggbokføring fra sporet?')) logFromTrack(t);
}

function logFromTrack(t: Track): void {
  const [from, to] = t.name.split(' → ');
  const first = t.points[0];
  const last = t.points[t.points.length - 1];
  const entry: LogEntry = {
    id: uid(),
    date: new Date(t.started).toISOString().slice(0, 10),
    aircraft: state.currentAircraft.registration,
    from: from ?? '',
    to: to ?? '',
    blockMin: Math.round((last.t - first.t) / 60000),
    landings: 1,
    night: isNight(new Date(last.t), last.lat, last.lon),
    remarks: '',
  };
  state.logbook.unshift(entry);
  state.saveLogbook();
  toast('Loggført – rediger detaljer ved behov');
}

function entryForm(): HTMLElement {
  const e: LogEntry = {
    id: '',
    date: new Date().toISOString().slice(0, 10),
    aircraft: state.currentAircraft.registration,
    from: '',
    to: '',
    blockMin: 60,
    landings: 1,
    night: false,
    remarks: '',
  };
  return h(
    'details',
    null,
    h('summary', null, '+ Ny føring'),
    h(
      'div',
      { class: 'grid2' },
      textField('Dato', e.date, (v) => (e.date = v), { type: 'date' }),
      textField('Fly', e.aircraft, (v) => (e.aircraft = v)),
      textField('Fra', '', (v) => (e.from = v.toUpperCase())),
      textField('Til', '', (v) => (e.to = v.toUpperCase())),
      numField('Blokktid', e.blockMin, (v) => (e.blockMin = v), { unit: 'min' }),
      numField('Landinger', e.landings, (v) => (e.landings = v), { step: 1 }),
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (ev: Event) => (e.night = (ev.target as HTMLInputElement).checked) }), ' Natt'),
    textField('Merknad', '', (v) => (e.remarks = v)),
    h(
      'button',
      {
        class: 'primary',
        onclick: () => {
          state.logbook.unshift({ ...e, id: uid() });
          state.logbook.sort((a, b) => b.date.localeCompare(a.date));
          state.saveLogbook();
        },
      },
      'Lagre føring',
    ),
  );
}

function exportCsv(): void {
  const head = 'dato;fly;fra;til;blokktid_min;landinger;natt;merknad';
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = state.logbook.map((e) => [e.date, q(e.aircraft), e.from, e.to, e.blockMin, e.landings, e.night ? 1 : 0, q(e.remarks)].join(';'));
  download('loggbok.csv', '﻿' + [head, ...lines].join('\n'), 'text/csv');
}
