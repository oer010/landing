import type { AeroDb, Airport, Navaid } from '../lib/data';
import { distanceNm, parseCoordinate, type LatLon } from '../lib/geo';
import type { Waypoint } from '../lib/navlog';
import type { WindAloft } from '../lib/winds';
import {
  DEFAULT_SETTINGS,
  defaultChecklists,
  exampleAircraft,
  load,
  save,
  type Aircraft,
  type Checklist,
  type LogEntry,
  type SavedRoute,
  type Settings,
  type Track,
} from '../lib/store';

export interface Position extends LatLon {
  t: number;
  gsKt: number | null;
  trkTrue: number | null;
  altFt: number | null;
  source: 'gps' | 'sim';
}

export interface RouteState {
  name: string;
  waypoints: Waypoint[];
  altitudeFt: number;
  windDir: number;
  windSpeed: number;
  departureTime: string;
  fuelOnBoard: number | null;
  persons: number;
  alternate: string;
  /** Prognosevind per legg, gyldig bare så lenge `key` stemmer med ruten. */
  forecast?: { key: string; fetchedAt: string; winds: (WindAloft | null)[] } | null;
}

/** Endres når rute, høyde eller avgangstid endres (da må vinden hentes på nytt). */
export const forecastKey = (r: RouteState): string =>
  JSON.stringify([r.waypoints.map((w) => [w.lat.toFixed(3), w.lon.toFixed(3), w.legAltFt ?? null]), r.altitudeFt, r.departureTime]);

/** Prognosevind for gjeldende rute, eller undefined om den mangler/er utdatert. */
export function activeLegWinds(r: RouteState = state.route): (WindAloft | null)[] | undefined {
  return r.forecast && r.forecast.key === forecastKey(r) ? r.forecast.winds : undefined;
}

type Events = 'wind' | 'airspace' | 'route' | 'position' | 'settings' | 'aircraft' | 'tracks' | 'logbook' | 'checklists' | 'nav' | 'select';

class AppState {
  db!: AeroDb;
  settings: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) };
  aircraft: Aircraft[] = load<Aircraft[]>('aircraft', []);
  currentAircraftId: string = load('currentAircraft', 'example');
  route: RouteState = load<RouteState>('route', {
    name: 'Ny rute',
    waypoints: [],
    altitudeFt: 3500,
    windDir: 0,
    windSpeed: 0,
    departureTime: '',
    fuelOnBoard: null,
    persons: 1,
    alternate: '',
  });
  savedRoutes: SavedRoute[] = load<SavedRoute[]>('savedRoutes', []);
  tracks: Track[] = load<Track[]>('tracks', []);
  logbook: LogEntry[] = load<LogEntry[]>('logbook', []);
  checklists: Checklist[] = load<Checklist[]>('checklists', defaultChecklists());
  position: Position | null = null;
  recording: Track | null = null;
  /** Indeks til veipunktet vi flyr mot. */
  activeIndex = 1;
  /** Direkte-til-mål (overstyrer ruten) */
  directTo: { from: LatLon; to: Waypoint } | null = null;
  following = true;

  private listeners = new Map<Events, Set<() => void>>();

  constructor() {
    if (!this.aircraft.length) this.aircraft = [exampleAircraft()];
  }

  on(ev: Events, fn: () => void): () => void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
    return () => this.listeners.get(ev)!.delete(fn);
  }

  emit(ev: Events): void {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  get currentAircraft(): Aircraft {
    return this.aircraft.find((a) => a.id === this.currentAircraftId) ?? this.aircraft[0];
  }

  setRoute(patch: Partial<RouteState>): void {
    this.route = { ...this.route, ...patch };
    save('route', this.route);
    if (this.activeIndex >= this.route.waypoints.length) this.activeIndex = Math.max(1, this.route.waypoints.length - 1);
    this.emit('route');
    this.emit('nav');
  }

  setWaypoints(wps: Waypoint[]): void {
    this.setRoute({ waypoints: wps });
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    save('settings', this.settings);
    this.emit('settings');
  }

  saveAircraft(): void {
    save('aircraft', this.aircraft);
    save('currentAircraft', this.currentAircraftId);
    this.emit('aircraft');
    this.emit('route');
  }

  saveTracks(): void {
    save('tracks', this.tracks);
    this.emit('tracks');
  }

  saveLogbook(): void {
    save('logbook', this.logbook);
    this.emit('logbook');
  }

  saveChecklists(): void {
    save('checklists', this.checklists);
    this.emit('checklists');
  }

  saveRoutes(): void {
    save('savedRoutes', this.savedRoutes);
  }

  /** Valgt objekt på kartet/listen (for detaljvisning). */
  selectedAirport: Airport | null = null;
  selectAirport(a: Airport | null): void {
    this.selectedAirport = a;
    this.emit('select');
  }
}

export const state = new AppState();

export function airportToWaypoint(a: Airport): Waypoint {
  return { id: a.ident, name: a.name, kind: 'airport', lat: a.lat, lon: a.lon, elevFt: a.elevFt };
}

export function navaidToWaypoint(n: Navaid): Waypoint {
  return { id: n.ident, name: `${n.name} ${n.type}`, kind: 'navaid', lat: n.lat, lon: n.lon, elevFt: n.elevFt };
}

let userCounter = 1;
export function userWaypoint(p: LatLon, name?: string): Waypoint {
  return { id: name ?? `BRK${userCounter++}`, kind: 'user', lat: p.lat, lon: p.lon };
}

/** Tolker en rute skrevet som tekst: "ENKJ OSL 6030N00930E GRM ENBR". */
export function parseRouteString(db: AeroDb, text: string): { waypoints: Waypoint[]; errors: string[] } {
  const tokens = text
    .toUpperCase()
    .split(/[\s;]+/)
    .filter((t) => t && t !== 'DCT');
  const waypoints: Waypoint[] = [];
  const errors: string[] = [];
  for (const tok of tokens) {
    const prev = waypoints[waypoints.length - 1];
    const ap = db.byIdent.get(tok);
    const navs = db.navaidsByIdent.get(tok);
    if (ap && (!navs || tok.length === 4)) {
      waypoints.push(airportToWaypoint(ap));
      continue;
    }
    if (navs?.length) {
      const ref = prev ?? ap ?? navs[0];
      const best = [...navs].sort((a, b) => distanceNm(ref, a) - distanceNm(ref, b))[0];
      waypoints.push(navaidToWaypoint(best));
      continue;
    }
    const c = parseCoordinate(tok);
    if (c) {
      waypoints.push({ id: tok.slice(0, 11), kind: 'user', ...c });
      continue;
    }
    errors.push(tok);
  }
  return { waypoints, errors };
}

export const routeToString = (wps: Waypoint[]): string =>
  wps
    .map((w) => {
      if (w.kind !== 'user') return w.id;
      const lat = Math.abs(w.lat);
      const lon = Math.abs(w.lon);
      const dm = (v: number, n: number) => {
        let d = Math.floor(v);
        let m = Math.round((v - d) * 60);
        if (m === 60) {
          d++;
          m = 0;
        }
        return String(d).padStart(n, '0') + String(m).padStart(2, '0');
      };
      return `${dm(lat, 2)}${w.lat < 0 ? 'S' : 'N'}${dm(lon, 3)}${w.lon < 0 ? 'W' : 'E'}`;
    })
    .join(' ');
