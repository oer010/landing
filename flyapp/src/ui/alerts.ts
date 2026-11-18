// Varsler i lufta: luftrom foran (innen 2 min) og hindre foran som flyet er for lavt for.

import { airspaceAhead, KIND_TEXT, type AirspaceDb } from '../lib/airspace';
import { obstaclesAhead, OBSTACLE_TEXT } from '../lib/obstacles';
import { terrainAhead } from '../lib/terrain';
import { h } from './dom';
import { getAirspaceDb } from './map';
import { obstacleData } from './obstaclelayer';
import { state } from './state';

let bar: HTMLElement;
let audio: AudioContext | null = null;
const lastShown = new Map<string, number>();
let lastAlt: { t: number; ft: number } | null = null;
let vsFpm = 0;
/** Siste terrengsjekk (hentes maks hvert 15. sekund, krever nett). */
let terrain: { t: number; ft: number; distNm: number; groundFt: number | null } | null = null;
/** Varsler brukeren har trykket vekk (eller som har stått i 5 min): skjult til tidspunktet. */
const dismissed = new Map<string, number>();
/** Når hvert varsel først ble vist (for automatisk skjuling etter 5 min). */
const firstShown = new Map<string, number>();
const HIDE_MS = 5 * 60e3;
let staleTimer: number | undefined;
let terrainBusy = false;

function beep(urgent: boolean): void {
  if (!state.settings.alertSound) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = urgent ? 1050 : 760;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (urgent ? 0.6 : 0.35));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.65);
  } catch {
    /* ingen lyd */
  }
}

/** Lyd i Safari må låses opp med et trykk. */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* ignorer */
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function initAlerts(host: HTMLElement): void {
  bar = h('div', { id: 'alert-bar', hidden: true });
  host.append(bar);
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchend', unlockAudio, { once: true });
  state.on('position', check);
}

function check(): void {
  const p = state.position;
  const s = state.settings;
  // Skjul varslene hvis GPS slutter å sende posisjoner (f.eks. når du står stille).
  clearTimeout(staleTimer);
  staleTimer = window.setTimeout(() => (bar.hidden = true), 20000);
  if (!p || p.gsKt === null || p.trkTrue === null || p.altFt === null || p.gsKt < 40) {
    bar.hidden = true;
    return;
  }
  // I lufta? Med kjent bakkehøyde: over 200 ft over bakken. Uten: over 60 kt
  // (unngår varsler i bil, under taksing og på startløpet).
  const ground = terrain && Date.now() - terrain.t < 60000 ? terrain.groundFt : null;
  const airborne = ground !== null ? p.altFt - ground > 200 && p.gsKt >= 40 : p.gsKt >= 60;
  // Vertikalfart fra høydeendring (glattet).
  if (lastAlt && p.t > lastAlt.t) {
    const v = ((p.altFt - lastAlt.ft) / (p.t - lastAlt.t)) * 60000;
    vsFpm = vsFpm * 0.7 + Math.max(-3000, Math.min(3000, v)) * 0.3;
  }
  lastAlt = { t: p.t, ft: p.altFt };

  const msgs: { key: string; text: string; urgent: boolean }[] = [];
  const db: AirspaceDb | null = getAirspaceDb();
  if (s.alertAirspace && db) {
    for (const { airspace: a, inSec } of airspaceAhead(db, p, p.trkTrue, p.gsKt, p.altFt, { vsFpm }).slice(0, 2)) {
      const restricted = a.kind === 'R' || a.kind === 'P' || a.kind === 'D';
      msgs.push({
        key: `as:${a.n}`,
        text: `${restricted ? '⛔' : '◭'} ${KIND_TEXT[a.kind] ?? a.kind} ${a.n} om ${mmss(inSec)}${a.f ? ` · ${a.f}` : ''}`,
        urgent: restricted || inSec <= 60,
      });
    }
  }
  const od = obstacleData();
  if (s.alertObstacles && od) {
    const t = obstaclesAhead(od.obstacles, p, p.trkTrue, p.gsKt, p.altFt)[0];
    if (t)
      msgs.push({
        key: `ob:${t.o.lat},${t.o.lon}`,
        text: `⚠ ${OBSTACLE_TEXT[t.o.type]} ${Math.round(t.o.heightM * 3.28084)} ft høy, ${t.distNm.toFixed(1)} NM foran${
          t.clearanceFt !== null ? ` · ${t.clearanceFt >= 0 ? `bare ${Math.round(t.clearanceFt)} ft over toppen` : `du er ${Math.round(-t.clearanceFt)} ft UNDER toppen`}` : ''
        }`,
        urgent: true,
      });
  }
  if (s.alertTerrain) {
    if (!terrainBusy && navigator.onLine && (!terrain || Date.now() - terrain.t > 15000)) {
      terrainBusy = true;
      terrainAhead(p, p.trkTrue, p.gsKt)
        .then((r) => (terrain = r ? { t: Date.now(), ...r } : { t: Date.now(), ft: 0, distNm: 0, groundFt: null }))
        .catch(() => undefined)
        .finally(() => (terrainBusy = false));
    }
    // Bruk bare ferskt resultat.
    if (terrain && Date.now() - terrain.t < 45000 && terrain.ft > p.altFt - 500)
      msgs.push({
        key: 'terrain',
        text: `⛰ TERRENG ${Math.round(terrain.ft)} ft ${terrain.distNm.toFixed(1)} NM foran · ${p.altFt >= terrain.ft ? `bare ${Math.round(p.altFt - terrain.ft)} ft over` : `du er ${Math.round(terrain.ft - p.altFt)} ft UNDER`}`,
        urgent: true,
      });
  }
  const now = Date.now();
  // Varsler som er borte, kan vises på nytt neste gang de dukker opp.
  for (const k of [...firstShown.keys()]) if (!msgs.some((m) => m.key === k)) firstShown.delete(k);
  const visible = (airborne ? msgs : []).filter((m) => {
    if ((dismissed.get(m.key) ?? 0) > now) return false;
    const first = firstShown.get(m.key) ?? now;
    firstShown.set(m.key, first);
    if (now - first > HIDE_MS) {
      dismissed.set(m.key, now + HIDE_MS);
      return false;
    }
    return true;
  });
  if (!visible.length) {
    bar.hidden = true;
    return;
  }
  bar.replaceChildren(
    ...visible.map((m) =>
      h(
        'div',
        {
          class: m.urgent ? 'urgent' : '',
          title: 'Trykk for å skjule i 5 min',
          onclick: (e: Event) => {
            // Trykk = skjul dette varselet i 5 minutter.
            dismissed.set(m.key, Date.now() + HIDE_MS);
            (e.currentTarget as HTMLElement).remove();
            if (!bar.children.length) bar.hidden = true;
          },
        },
        m.text,
        h('span', { class: 'alert-x' }, '✕'),
      ),
    ),
  );
  bar.hidden = false;
  // Lyd bare første gang (og igjen etter 60 s) for hvert varsel.
  for (const m of visible) {
    if (now - (lastShown.get(m.key) ?? 0) > 60000) beep(m.urgent);
    lastShown.set(m.key, now);
  }
}
