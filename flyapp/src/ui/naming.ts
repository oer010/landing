// Gir nye/flyttede brukerpunkter navnet på nærmeste sted automatisk,
// med mindre brukeren har gitt punktet et eget navn.

import { nearestPlaceName, shortName } from '../lib/placenames';
import type { Waypoint } from '../lib/navlog';
import { state } from './state';

let timer: number | undefined;
let running = false;

const same = (a: Waypoint, b: Waypoint) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;

async function nameNext(): Promise<void> {
  if (running) return;
  const target = state.route.waypoints.find((w) => w.kind === 'user' && w.needsName);
  if (!target) return;
  running = true;
  let patch: Partial<Waypoint> = { needsName: false };
  try {
    const p = await nearestPlaceName(target);
    if (p) {
      const km = p.distM / 1000;
      patch = { needsName: false, autoName: true, id: shortName(p.name), name: `${p.type}${km >= 1 ? `, ${km.toFixed(1)} km unna` : ''} (Kartverket)` };
    }
  } catch {
    // Offline eller utenfor Norge: behold koordinatnavnet.
  }
  running = false;
  // Punktet kan ha blitt flyttet/slettet mens vi ventet – oppdater bare om det fortsatt står der.
  const wps = state.route.waypoints;
  const i = wps.findIndex((w) => w.needsName && same(w, target));
  if (i >= 0) {
    const next = [...wps];
    next[i] = { ...wps[i], ...patch };
    state.setWaypoints(next);
  }
  void nameNext();
}

export function initAutoNaming(): void {
  const schedule = () => {
    clearTimeout(timer);
    if (state.route.waypoints.some((w) => w.kind === 'user' && w.needsName)) timer = window.setTimeout(() => void nameNext(), 700);
  };
  state.on('route', schedule);
  schedule();
}

/** Gi et punkt eget navn (tomt navn = finn stedsnavn automatisk igjen). */
export function renameWaypoint(index: number, name: string): void {
  const wps = [...state.route.waypoints];
  const w = wps[index];
  if (!w) return;
  const n = name.trim();
  wps[index] = n ? { ...w, id: n.slice(0, 20), name: undefined, manualName: true, autoName: false, needsName: false } : { ...w, manualName: false, needsName: w.kind === 'user' };
  state.setWaypoints(wps);
}
