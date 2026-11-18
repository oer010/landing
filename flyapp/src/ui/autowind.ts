// Henter prognosevind automatisk når rute, marsjhøyde eller avgangstid endres,
// slik at navloggen alltid bygger på reell vind (retning/styrke per legg).

import { midpoint } from '../lib/geo';
import { computeNavlog } from '../lib/navlog';
import { fetchLegWinds } from '../lib/winds';
import { activeLegWinds, forecastKey, state } from './state';

export type WindStatus = { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string };

let status: WindStatus = { state: 'idle' };
let timer: number | undefined;
let inflightKey: string | null = null;
/** Ikke prøv samme rute igjen med en gang etter en feil. */
let failedKey: string | null = null;
let failedAt = 0;

export const windStatus = () => status;

function setStatus(s: WindStatus): void {
  status = s;
  state.emit('wind');
}

/** Henter vind for gjeldende rute. `force` = også om den allerede er hentet. */
export async function fetchForecastWind(force = false): Promise<void> {
  const r = state.route;
  if (r.waypoints.length < 2) return;
  const key = forecastKey(r);
  if (!force && (activeLegWinds(r) || inflightKey === key)) return;
  inflightKey = key;
  setStatus({ state: 'loading' });
  try {
    const dep = r.departureTime ? new Date(r.departureTime) : new Date();
    const ac = state.currentAircraft;
    // Tidspunkt midt i hvert legg (grovt med manuell vind; timeoppløsning holder).
    const legs = computeNavlog(r.waypoints, { tas: ac.tas, wind: { dir: r.windDir, speed: r.windSpeed }, fuelBurn: ac.fuelBurn, altitudeFt: r.altitudeFt, date: dep });
    const reqs = legs.map((l) => ({
      point: midpoint(l.from, l.to),
      altFt: l.altFt,
      time: new Date(dep.getTime() + Math.max(0, (l.cumMin ?? 0) - (l.eteMin ?? 0) / 2) * 60000),
    }));
    const winds = await fetchLegWinds(reqs, r.altitudeFt);
    if (winds.every((w) => !w)) throw new Error('Prognosen dekker ikke avgangstidspunktet.');
    // Ruten kan ha endret seg mens vi ventet – lagre bare om den er den samme.
    if (forecastKey(state.route) === key) {
      state.setRoute({ forecast: { key, fetchedAt: new Date().toISOString(), winds } });
      setStatus({ state: 'ok' });
    } else setStatus({ state: 'idle' });
    failedKey = null;
  } catch (e) {
    failedKey = key;
    failedAt = Date.now();
    setStatus({ state: 'error', message: (e as Error).message || 'Kunne ikke hente vind (offline?)' });
  } finally {
    if (inflightKey === key) inflightKey = null;
  }
}

/** Start automatisk henting (kalles én gang ved oppstart). */
export function initAutoWind(): void {
  const schedule = () => {
    clearTimeout(timer);
    const r = state.route;
    if (r.waypoints.length < 2 || activeLegWinds(r)) return;
    const key = forecastKey(r);
    if (key === failedKey && Date.now() - failedAt < 120000) return;
    // Vent til brukeren er ferdig med å dra punkter/skrive.
    timer = window.setTimeout(() => void fetchForecastWind(), 1500);
  };
  state.on('route', schedule);
  schedule();
}
