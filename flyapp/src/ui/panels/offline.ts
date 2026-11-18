// «Kart uten nett»: last ned Kartverket-fliser for et område, ruten eller kartutsnittet.

import { AREAS, AVG_TILE_KB, clearOfflineTiles, downloadTiles, offlineTileCount, storageEstimate, tilesAlongRoute, tilesInBox, type TileRef } from '../../lib/offline';
import { h, section, toast } from '../dom';
import { map } from '../map';
import { state } from '../state';

let running: AbortController | null = null;
/** Siste fremdrift, så den overlever at panelet tegnes på nytt. */
let lastInfo = '';
let lastBar = { max: 1, value: 0 };

export function offlineSection(): HTMLElement {
  const status = h('p', { id: 'offline-status', class: 'muted small' }, 'Sjekker lagrede kart …');
  const bar = h('progress', { id: 'offline-bar', max: lastBar.max, value: lastBar.value, hidden: !running, style: 'width:100%' }) as HTMLProgressElement;
  const info = h('p', { id: 'offline-info', class: 'small', hidden: !lastInfo }, lastInfo);
  const cur = () => ({
    bar: (document.getElementById('offline-bar') as HTMLProgressElement | null) ?? bar,
    info: document.getElementById('offline-info') ?? info,
    cancel: document.getElementById('offline-cancel') ?? cancel,
    status: document.getElementById('offline-status') ?? status,
  });
  const refresh = async () => {
    const [n, est] = await Promise.all([offlineTileCount(), storageEstimate()]);
    cur().status.textContent = `${n} kartfliser lagret for bruk uten nett${est ? ` · lagring brukt ${est.usedMb} MB av ${est.quotaMb} MB` : ''}.`;
  };
  void refresh();

  const start = async (label: string, tiles: TileRef[]) => {
    if (running) return toast('En nedlasting pågår allerede', 'warn');
    const mb = Math.round((tiles.length * AVG_TILE_KB) / 1024);
    if (!confirm(`Laste ned ${label}: ${tiles.length} kartfliser (ca. ${mb} MB)?\n\nBruk gjerne Wi-Fi. Fliser du allerede har, hoppes over.`)) return;
    if (state.settings.baseLayer !== 'kv') state.updateSettings({ baseLayer: 'kv' });
    running = new AbortController();
    lastInfo = 'Starter …';
    const show = () => {
      const c = cur();
      c.bar.hidden = !running;
      c.bar.max = lastBar.max;
      c.bar.value = lastBar.value;
      c.info.hidden = false;
      c.info.textContent = lastInfo;
      c.cancel.hidden = !running;
    };
    show();
    const t0 = Date.now();
    const p = await downloadTiles(
      tiles,
      (pr) => {
        lastBar = { max: pr.total, value: pr.done };
        const rate = pr.done / Math.max(1, (Date.now() - t0) / 1000);
        const left = rate > 0 ? Math.round((pr.total - pr.done) / rate) : 0;
        lastInfo = `${pr.done} av ${pr.total}${pr.failed ? ` · ${pr.failed} feilet` : ''} · ca. ${left < 90 ? `${left} s` : `${Math.round(left / 60)} min`} igjen`;
        show();
      },
      running.signal,
    );
    const aborted = running.signal.aborted;
    running = null;
    lastInfo = aborted
      ? `Avbrutt etter ${p.done} av ${p.total}.`
      : `Ferdig: ${p.total - p.failed - p.skipped} nye, ${p.skipped} hadde du fra før${p.failed ? `, ${p.failed} feilet (prøv igjen)` : ''}.`;
    show();
    toast(aborted ? 'Nedlasting avbrutt' : 'Kart lastet ned for bruk uten nett');
    void refresh();
  };
  const cancel = h('button', { id: 'offline-cancel', hidden: !running, onclick: () => running?.abort() }, 'Avbryt');

  return section(
    'Kart uten nett',
    h(
      'p',
      { class: 'muted small' },
      'Last ned Kartverkets topografiske kart på forhånd, så kartet virker i lufta uten mobildekning. Flyplasser, luftrom, VFR-punkter og hindre ligger alltid lagret i appen.',
    ),
    h(
      'div',
      { class: 'row wrap' },
      Object.entries(AREAS).map(([, a]) => h('button', { onclick: () => start(`${a.label} (oversikt)`, tilesInBox(a.box, 5, a.zMax)) }, `${a.label}`)),
    ),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'button',
        {
          onclick: () => {
            const wps = state.route.waypoints;
            if (wps.length < 2) return toast('Legg inn en rute først', 'warn');
            // Detaljert langs ruten (±10 NM) og rundt flyplassene.
            const tiles = tilesAlongRoute(wps, 10, 7, 12);
            void start('kart langs ruten (±10 NM, detaljert)', tiles);
          },
        },
        'Langs ruten (detaljert)',
      ),
      h(
        'button',
        {
          onclick: () => {
            const b = map.getBounds();
            const z = map.getZoom();
            void start('kartutsnittet du ser', tilesInBox([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], Math.max(5, z - 2), Math.min(13, z + 2)));
          },
        },
        'Det du ser nå',
      ),
    ),
    bar,
    info,
    cancel,
    status,
    h(
      'button',
      {
        class: 'link',
        onclick: async () => {
          if (!confirm('Slette alle nedlastede kart?')) return;
          await clearOfflineTiles();
          toast('Nedlastede kart slettet');
          void refresh();
        },
      },
      'Slett nedlastede kart',
    ),
  );
}
