// Posisjon fra GPS eller simulator, sekvensering av veipunkter og sporlogging.

import { bearingTrue, destination, distanceNm, type LatLon } from '../lib/geo';
import { windTriangle, type Waypoint } from '../lib/navlog';
import { nearestAirports } from '../lib/data';
import { uid, type Track } from '../lib/store';
import { Geolocation } from '@capacitor/geolocation';
import { isNative } from '../lib/platform';
import { toast } from './dom';
import { state, type Position } from './state';

let watchId: string | null = null;
let gpsOn = false;
let webWatchId: number | null = null;
let lastGpsWarn = 0;
let simTimer: number | null = null;
let simSpeed = 1;
let lastFix: Position | null = null;

export const gpsActive = () => gpsOn;
export const simActive = () => simTimer !== null;

export interface Leg {
  from: LatLon;
  to: Waypoint;
}

export function activeLeg(): Leg | null {
  if (state.directTo) return state.directTo;
  const wps = state.route.waypoints;
  const i = state.activeIndex;
  if (wps.length < 2 || i < 1 || i >= wps.length) return null;
  return { from: wps[i - 1], to: wps[i] };
}

export function directTo(w: Waypoint): void {
  const from = state.position ?? state.route.waypoints[state.activeIndex - 1] ?? w;
  // Om målet er i ruten: fortsett ruten etterpå.
  const idx = state.route.waypoints.findIndex((x) => x.id === w.id && Math.abs(x.lat - w.lat) < 1e-6);
  if (idx >= 0) state.activeIndex = Math.max(1, idx);
  state.directTo = { from: { lat: from.lat, lon: from.lon }, to: w };
  toast(`Direkte til ${w.id}`);
  state.emit('nav');
  state.emit('route');
}

export function cancelDirectTo(): void {
  state.directTo = null;
  state.emit('nav');
  state.emit('route');
}

export function setActiveIndex(i: number): void {
  state.activeIndex = Math.min(Math.max(1, i), Math.max(1, state.route.waypoints.length - 1));
  state.directTo = null;
  state.emit('nav');
  state.emit('route');
}

function sequence(p: Position): void {
  const leg = activeLeg();
  if (!leg) return;
  const d = distanceNm(p, leg.to);
  // Passert når vi er nær nok, eller veipunktet er bak oss.
  const behind = p.trkTrue !== null && d < 3 && Math.abs(((bearingTrue(p, leg.to) - p.trkTrue + 540) % 360) - 180) > 100;
  if (d < 0.5 || behind) {
    const wps = state.route.waypoints;
    if (state.directTo) {
      const idx = wps.findIndex((x) => x.id === leg.to.id && Math.abs(x.lat - leg.to.lat) < 1e-6);
      state.directTo = null;
      if (idx >= 0 && idx < wps.length - 1) state.activeIndex = idx + 1;
      else return;
    } else if (state.activeIndex < wps.length - 1) state.activeIndex++;
    else return;
    toast(`Neste: ${activeLeg()?.to.id ?? ''}`);
    state.emit('route');
  }
}

function setPosition(p: Position): void {
  // Beregn track/fart fra forrige fix om enheten ikke oppgir dem.
  if (lastFix && (p.trkTrue === null || p.gsKt === null)) {
    const dt = (p.t - lastFix.t) / 3600000;
    const d = distanceNm(lastFix, p);
    if (dt > 0 && d > 0.005) {
      p.trkTrue ??= bearingTrue(lastFix, p);
      p.gsKt ??= d / dt;
    } else {
      p.trkTrue ??= lastFix.trkTrue;
      p.gsKt ??= lastFix.gsKt;
    }
  }
  lastFix = p;
  state.position = p;
  if (state.recording) {
    const pts = state.recording.points;
    const prev = pts[pts.length - 1];
    if (!prev || p.t - prev.t > 4000 || distanceNm(prev, p) > 0.1)
      pts.push({ t: p.t, lat: p.lat, lon: p.lon, altM: p.altFt !== null ? p.altFt * 0.3048 : null, gsKt: p.gsKt });
  }
  sequence(p);
  state.emit('position');
  state.emit('nav');
}

const DENIED_HELP =
  'Posisjon er ikke tillatt. På iPhone: Innstillinger → Personvern og sikkerhet → Stedstjenester: slå på, og sett «Safari-nettsteder» til «Når appen er i bruk» (og slå på «Presis posisjon»). Last så appen inn på nytt.';

interface Fix {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  speed?: number | null;
  course?: number | null;
}

let gotFix = false;

function onFix(c: Fix, timestamp: number): void {
  if (!gpsOn) return;
  if (!gotFix) {
    gotFix = true;
    toast('GPS-posisjon funnet');
  }
  // iOS rapporterer -1 for ugyldig fart/kurs.
  const speed = c.speed !== null && c.speed !== undefined && c.speed >= 0 ? c.speed : null;
  // Bevegelsesretning (rettvisende), ikke kompass.
  const course = c.course !== null && c.course !== undefined && c.course >= 0 && (speed ?? 0) > 1 ? c.course : null;
  setPosition({
    lat: c.latitude,
    lon: c.longitude,
    t: timestamp,
    gsKt: speed !== null ? speed / 0.514444 : null,
    trkTrue: course,
    altFt: c.altitude !== null && c.altitude !== undefined ? c.altitude / 0.3048 : null,
    source: 'gps',
  });
}

function onGpsError(code: number | undefined, message: string): void {
  if (code === 1) {
    toast(DENIED_HELP, 'error', 15000);
    stopGps();
  } else if (Date.now() - lastGpsWarn > 30000) {
    lastGpsWarn = Date.now();
    toast(gotFix ? 'Svakt eller manglende GPS-signal' : `Venter på GPS-signal … ${message ? `(${message})` : ''}`, 'warn');
  }
}

export function startGps(): void {
  if (gpsOn) return;
  stopSim();
  gpsOn = true;
  gotFix = false;
  state.following = true;
  state.emit('nav');

  if (!isNative()) {
    // Nettleser: kall geolocation direkte i trykket, slik Safari forventer.
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      toast('Denne nettleseren gir ikke tilgang til posisjon (krever https).', 'error', 8000);
      stopGps();
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        // I nettleseren er `heading` bevegelsesretningen.
        onFix({ latitude: c.latitude, longitude: c.longitude, altitude: c.altitude, speed: c.speed, course: c.heading }, pos.timestamp);
      },
      (err) => onGpsError(err.code, err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 },
    );
    webWatchId = id;
    toast(`GPS på – venter på posisjon … (v ${__BUILD__})`);
    return;
  }

  void (async () => {
    try {
      const perm = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (perm.location === 'denied') throw Object.assign(new Error('denied'), { code: 1 });
      const id = await Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 }, (pos, err) => {
        if (err || !pos) return onGpsError((err as { code?: number } | undefined)?.code, err?.message ?? '');
        onFix(pos.coords, pos.timestamp);
      });
      if (!gpsOn) await Geolocation.clearWatch({ id });
      else watchId = id;
      toast('GPS på – venter på posisjon …');
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 1) onGpsError(1, '');
      else {
        toast(`GPS: ${(e as Error).message}`, 'error', 8000);
        stopGps();
      }
    }
  })();
}

export function stopGps(): void {
  gpsOn = false;
  if (watchId !== null) void Geolocation.clearWatch({ id: watchId });
  if (webWatchId !== null) navigator.geolocation.clearWatch(webWatchId);
  watchId = null;
  webWatchId = null;
  state.emit('nav');
}

/** Simulerer flyging langs ruten med flyets TAS og planlagt vind. */
export function startSim(multiplier = 4): void {
  const wps = state.route.waypoints;
  if (wps.length < 2) {
    toast('Legg inn en rute med minst to punkter først', 'warn');
    return;
  }
  stopGps();
  stopSim();
  simSpeed = multiplier;
  state.directTo = null;
  state.activeIndex = 1;
  lastFix = null;
  let pos: LatLon = { lat: wps[0].lat, lon: wps[0].lon };
  const alt = state.route.altitudeFt;
  const ac = state.currentAircraft;
  const step = 1; // sekunder sanntid
  const tick = () => {
    const leg = activeLeg();
    if (!leg) return stopSim();
    const tc = bearingTrue(pos, leg.to);
    const sol = windTriangle(tc, ac.tas, { dir: state.route.windDir, speed: state.route.windSpeed });
    const gs = sol?.groundSpeed ?? ac.tas;
    const distStep = (gs * step * simSpeed) / 3600;
    const remaining = distanceNm(pos, leg.to);
    const last = state.activeIndex >= wps.length - 1 && !state.directTo;
    pos = remaining <= distStep ? { lat: leg.to.lat, lon: leg.to.lon } : destination(pos, tc, distStep);
    setPosition({ ...pos, t: Date.now(), gsKt: gs, trkTrue: tc, altFt: alt, source: 'sim' });
    if (last && remaining <= distStep) {
      toast('Simulering: fremme');
      stopSim();
    }
  };
  simTimer = window.setInterval(tick, step * 1000);
  state.following = true;
  tick();
  toast(`Simulering ×${multiplier}`);
}

export function stopSim(): void {
  if (simTimer !== null) clearInterval(simTimer);
  simTimer = null;
  state.emit('nav');
}

export function stopPosition(): void {
  stopGps();
  stopSim();
  state.position = null;
  lastFix = null;
  state.emit('position');
  state.emit('nav');
}

export function startRecording(): void {
  if (state.recording) return;
  const now = Date.now();
  state.recording = { id: uid(), name: `Tur ${new Date(now).toLocaleString('nb-NO')}`, started: now, points: [] };
  toast('Sporlogging startet');
  state.emit('nav');
}

/** Stopper loggingen, lagrer sporet og foreslår en loggbokføring. */
export function stopRecording(): Track | null {
  const t = state.recording;
  state.recording = null;
  state.emit('nav');
  if (!t) return null;
  if (t.points.length < 2) {
    toast('Sporet var for kort og ble ikke lagret', 'warn');
    return null;
  }
  const first = t.points[0];
  const last = t.points[t.points.length - 1];
  const near = (p: LatLon) => nearestAirports(state.db, p, 1)[0];
  const from = near(first);
  const to = near(last);
  if (from && to) t.name = `${from.dist < 3 ? from.airport.ident : 'Ukjent'} → ${to.dist < 3 ? to.airport.ident : 'Ukjent'}`;
  state.tracks.unshift(t);
  state.saveTracks();
  toast(`Spor lagret: ${t.name}`);
  return t;
}
