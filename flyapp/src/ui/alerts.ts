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
let terrain: { t: number; ft: number; distNm: number } | null = null;
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
  bar = h('div', { id: 'alert-bar', hidden: true, onclick: () => (bar.hidden = true) });
  host.append(bar);
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchend', unlockAudio, { once: true });
  state.on('position', check);
}

function check(): void {
  const p = state.position;
  const s = state.settings;
  if (!p || p.gsKt === null || p.trkTrue === null || p.altFt === null || p.gsKt < 40) {
    bar.hidden = true;
    return;
  }
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
        text: `⚠ ${OBSTACLE_TEXT[t.o.type]} ${Math.round(t.o.heightM * 3.28084)} ft foran, ${t.distNm.toFixed(1)} NM${t.clearanceFt !== null ? ` · ${t.clearanceFt >= 0 ? `bare ${t.clearanceFt}` : `${-t.clearanceFt} ft UNDER`} ft over toppen` : ''}`,
        urgent: true,
      });
  }
  if (s.alertTerrain) {
    if (!terrainBusy && navigator.onLine && (!terrain || Date.now() - terrain.t > 15000)) {
      terrainBusy = true;
      terrainAhead(p, p.trkTrue, p.gsKt)
        .then((r) => (terrain = r ? { t: Date.now(), ...r } : { t: Date.now(), ft: 0, distNm: 0 }))
        .catch(() => undefined)
        .finally(() => (terrainBusy = false));
    }
    // Bruk bare ferskt resultat.
    if (terrain && Date.now() - terrain.t < 45000 && terrain.ft > p.altFt - 500)
      msgs.push({
        key: 'terrain',
        text: `⛰ TERRENG ${Math.round(terrain.ft)} ft foran (${terrain.distNm.toFixed(1)} NM) · du er ${Math.round(p.altFt - terrain.ft)} ft over`,
        urgent: true,
      });
  }
  if (!msgs.length) {
    bar.hidden = true;
    return;
  }
  bar.replaceChildren(...msgs.map((m) => h('div', { class: m.urgent ? 'urgent' : '' }, m.text)));
  bar.hidden = false;
  // Lyd bare første gang (og igjen etter 60 s) for hvert varsel.
  const now = Date.now();
  for (const m of msgs) {
    if (now - (lastShown.get(m.key) ?? 0) > 60000) beep(m.urgent);
    lastShown.set(m.key, now);
  }
}
