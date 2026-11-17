// Eksport: GPX (rute og spor), Garmin .fpl og ICAO flightplan-tekst.

import { formatIcaoCoord } from './geo';
import { saveFile } from './platform';
import type { Waypoint } from './navlog';
import type { Aircraft, Track } from './store';

const esc = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

/** Navn som tåles av GPS-er: A–Z/0–9, maks 6 tegn for brukerpunkter. */
const gpsIdent = (w: Waypoint, i: number) =>
  w.kind === 'user' ? (w.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || `WP${i}`) : w.id.toUpperCase();

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

/** Garmin FlightPlan (.fpl) – kan lastes inn i Garmin Pilot og mange panel-GPS-er. */
export function routeToFpl(name: string, wps: Waypoint[]): string {
  const typeOf = (w: Waypoint) => (w.kind === 'airport' ? 'AIRPORT' : w.kind === 'navaid' ? 'VOR' : 'USER WAYPOINT');
  const unique = new Map<string, string>();
  const ids = wps.map((w, i) => {
    const id = gpsIdent(w, i);
    unique.set(`${id}|${typeOf(w)}`, `    <waypoint>
      <identifier>${esc(id)}</identifier>
      <type>${typeOf(w)}</type>
      <lat>${w.lat.toFixed(6)}</lat>
      <lon>${w.lon.toFixed(6)}</lon>
    </waypoint>`);
    return [id, typeOf(w)];
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">
  <waypoint-table>
${[...unique.values()].join('\n')}
  </waypoint-table>
  <route>
    <route-name>${esc(name.slice(0, 25))}</route-name>
    <flight-plan-index>1</flight-plan-index>
${ids
  .map(
    ([id, type]) => `    <route-point>
      <waypoint-identifier>${esc(id)}</waypoint-identifier>
      <waypoint-type>${type}</waypoint-type>
    </route-point>`,
  )
  .join('\n')}
  </route>
</flight-plan>
`;
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
