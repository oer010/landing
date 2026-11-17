// Posisjon fra GPS eller simulator, sekvensering av veipunkter og sporlogging.

import { bearingTrue, destination, distanceNm, type LatLon } from '../lib/geo';
import { windTriangle, type Waypoint } from '../lib/navlog';
import { nearestAirports } from '../lib/data';
import { uid, type Track } from '../lib/store';
import { toast } from './dom';
import { state, type Position } from './state';

let watchId: number | null = null;
let simTimer: number | null = null;
let simSpeed = 1;
let lastFix: Position | null = null;

export const gpsActive = () => watchId !== null;
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

export function startGps(): void {
  if (!('geolocation' in navigator)) {
    toast('Enheten har ikke GPS/posisjon', 'error');
    return;
  }
  stopSim();
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      setPosition({
        lat: c.latitude,
        lon: c.longitude,
        t: pos.timestamp,
        gsKt: c.speed !== null && !Number.isNaN(c.speed) ? c.speed / 0.514444 : null,
        trkTrue: c.heading !== null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 1 ? c.heading : null,
        altFt: c.altitude !== null ? c.altitude / 0.3048 : null,
        source: 'gps',
      });
    },
    (err) => {
      toast(`GPS-feil: ${err.message}`, 'error');
      stopGps();
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
  );
  state.following = true;
  toast('GPS på');
  state.emit('nav');
}

export function stopGps(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
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
