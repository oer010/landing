// Eksport: GPX (rute og spor), Garmin .fpl og ICAO flightplan-tekst.

import { formatIcaoCoord } from './geo';
import { saveFile } from './platform';
import type { Waypoint } from './navlog';
import type { Aircraft, Track } from './store';

const esc = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

/** Navn som tåles av GPS-er: A–Z/0–9, maks 6 tegn for brukerpunkter. */
const translit = (s: string) =>
  s
    .toUpperCase()
    .replace(/Æ/g, 'AE')
    .replace(/Ø/g, 'O')
    .replace(/Å/g, 'A')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const gpsIdent = (w: Waypoint, i: number) =>
  w.kind === 'user' ? (translit(w.id).replace(/[^A-Z0-9]/g, '').slice(0, 6) || `WP${i}`) : w.id.toUpperCase();

export function routeToGpx(name: string, wps: Waypoint[]): string {
  const pts = wps
    .map(
      (w, i) =>
        `    <rtept lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${esc(gpsIdent(w, i))}</name>${w.name ? `<desc>${esc(w.name)}</desc>` : ''}</rtept>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VFR Flyapp" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${esc(name)}</name>
${pts}
  </rte>
</gpx>
`;
}

export function trackToGpx(t: Track): string {
  const pts = t.points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.altM !== null ? `<ele>${p.altM.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VFR Flyapp" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(t.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Garmin-type for punktet (G1000 matcher ident + type + landkode mot databasen). */
function fplType(w: Waypoint): string {
  if (w.kind === 'airport') return 'AIRPORT';
  if (w.kind === 'navaid') return /\bNDB\b/.test(w.name ?? '') ? 'NDB' : 'VOR';
  return 'USER WAYPOINT';
}

/** ICAO-landkode (to første bokstaver i ICAO-identen) – navaids får koden fra nærmeste flyplass i ruten. */
function countryCode(w: Waypoint, wps: Waypoint[]): string {
  if (w.kind === 'airport' && /^[A-Z]{4}$/.test(w.id)) return w.id.slice(0, 2);
  if (w.kind === 'navaid') {
    const ap = wps.filter((x) => x.kind === 'airport' && /^[A-Z]{4}$/.test(x.id)).sort((a, b) => Math.hypot(a.lat - w.lat, a.lon - w.lon) - Math.hypot(b.lat - w.lat, b.lon - w.lon))[0];
    return ap ? ap.id.slice(0, 2) : '';
  }
  return '';
}

/**
 * Garmin FlightPlan (.fpl, xmlschemas/FlightPlan/v1) – for G1000 (SD-kort), Garmin Pilot m.fl.
 * Brukerpunkter får unike identer på maks 6 tegn (A–Z, 0–9), som G1000 krever.
 */
export function routeToFpl(name: string, wps: Waypoint[], created = new Date()): string {
  const used = new Set<string>();
  const userIds = new Map<string, string>();
  const identOf = (w: Waypoint, i: number) => {
    if (w.kind !== 'user') return w.id.toUpperCase();
    const k = `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`;
    if (userIds.has(k)) return userIds.get(k)!;
    let id = gpsIdent(w, i);
    for (let n = 1; used.has(id); n++) id = `${id.slice(0, 6 - String(n).length)}${n}`;
    used.add(id);
    userIds.set(k, id);
    return id;
  };
  const table = new Map<string, string>();
  const points = wps.map((w, i) => {
    const id = identOf(w, i);
    const type = fplType(w);
    const cc = countryCode(w, wps);
    table.set(`${id}|${type}`, `    <waypoint>
      <identifier>${esc(id)}</identifier>
      <type>${type}</type>
      <country-code>${cc}</country-code>
      <lat>${w.lat.toFixed(6)}</lat>
      <lon>${w.lon.toFixed(6)}</lon>
      <comment>${type === 'USER WAYPOINT' ? esc(translit(w.name ?? w.id).replace(/[^A-Z0-9 ]/g, '').slice(0, 25)) : ''}</comment>
    </waypoint>`);
    return { id, type, cc };
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">
  <created>${created.toISOString().slice(0, 19)}Z</created>
  <waypoint-table>
${[...table.values()].join('\n')}
  </waypoint-table>
  <route>
    <route-name>${esc(translit(name).replace(/[^A-Z0-9 /-]/g, '').slice(0, 25) || 'VFR')}</route-name>
    <flight-plan-index>1</flight-plan-index>
${points
  .map(
    (p) => `    <route-point>
      <waypoint-identifier>${esc(p.id)}</waypoint-identifier>
      <waypoint-type>${p.type}</waypoint-type>
      <waypoint-country-code>${p.cc}</waypoint-country-code>
    </route-point>`,
  )
  .join('\n')}
  </route>
</flight-plan>
`;
}

/** Filnavn som G1000 tåler: store bokstaver/tall, maks 8 tegn + .fpl. */
export function fplFileName(wps: Waypoint[]): string {
  const a = wps[0]?.id ?? 'RUTE';
  const b = wps[wps.length - 1]?.id ?? '';
  const base = `${translit(a).replace(/[^A-Z0-9]/g, '').slice(0, 4)}${translit(b).replace(/[^A-Z0-9]/g, '').slice(0, 4)}` || 'RUTE';
  return `${base}.fpl`;
}

const hhmm = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
};

/** ICAO-flightplan (FPL) som tekst, til kopiering inn i innleveringstjenesten. */
export function icaoFlightPlan(o: {
  aircraft: Aircraft;
  waypoints: Waypoint[];
  eobt: Date;
  eetMin: number;
  enduranceMin: number;
  altitudeFt: number;
  tas: number;
  persons: number;
  alternate?: string;
  remarks?: string;
}): string {
  const ac = o.aircraft;
  const dep = o.waypoints[0];
  const dest = o.waypoints[o.waypoints.length - 1];
  const icaoAd = (w: Waypoint) => (w.kind === 'airport' && /^[A-Z]{4}$/.test(w.id) ? w.id : 'ZZZZ');
  const level = `A${String(Math.round(o.altitudeFt / 100)).padStart(3, '0')}`;
  const route = o.waypoints
    .slice(1, -1)
    .map((w) => (w.kind === 'navaid' ? w.id : formatIcaoCoord(w)))
    .map((p) => `DCT ${p}`)
    .join(' ');
  const item18: string[] = [];
  const dof = o.eobt.toISOString().slice(2, 10).replace(/-/g, '');
  item18.push(`DOF/${dof}`);
  if (icaoAd(dep) === 'ZZZZ') item18.push(`DEP/${formatIcaoCoord(dep)} ${dep.name ?? dep.id}`.toUpperCase());
  if (icaoAd(dest) === 'ZZZZ') item18.push(`DEST/${formatIcaoCoord(dest)} ${dest.name ?? dest.id}`.toUpperCase());
  if (o.remarks) item18.push(`RMK/${o.remarks.toUpperCase()}`);
  const reg = ac.registration.replace(/-/g, '').toUpperCase();
  return [
    `(FPL-${reg}-VG`,
    `-${ac.icaoType.toUpperCase()}/${ac.wake}-${ac.equipment}/${ac.surveillance}`,
    `-${icaoAd(dep)}${o.eobt.toISOString().slice(11, 13)}${o.eobt.toISOString().slice(14, 16)}`,
    `-N${String(Math.round(o.tas)).padStart(4, '0')}${level} ${route || 'DCT'}`.trimEnd(),
    `-${icaoAd(dest)}${hhmm(o.eetMin)}${o.alternate ? ` ${o.alternate.toUpperCase()}` : ''}`,
    `-${item18.join(' ')}`,
    `-E/${hhmm(o.enduranceMin)} P/${String(o.persons).padStart(3, '0')} A/${ac.colour.toUpperCase()})`,
  ].join('\n');
}

export function download(filename: string, content: string, type = 'application/octet-stream'): void {
  saveFile(filename, content, type).catch((e) => console.warn('Lagring/deling feilet', e));
}
