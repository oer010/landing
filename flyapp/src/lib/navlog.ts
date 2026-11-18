import { bearingTrue, distanceNm, norm180, norm360, type LatLon } from './geo';
import { declination, trueToMag } from './mag';

export interface Waypoint extends LatLon {
  /** Ident som vises (ICAO-kode, navaid eller brukerdefinert navn). */
  id: string;
  name?: string;
  kind: 'airport' | 'navaid' | 'user';
  elevFt?: number | null;
  /** Flyhøyde (ft MSL) på legget som ender i dette punktet. Mangler = rutens standardhøyde. */
  legAltFt?: number | null;
  /** Brukerpunkt som venter på automatisk stedsnavn. */
  needsName?: boolean;
  /** Navnet er hentet automatisk (Kartverket). */
  autoName?: boolean;
  /** Brukeren har gitt punktet eget navn – ikke overskriv. */
  manualName?: boolean;
}

export interface Wind {
  /** Retning vinden kommer FRA, rettvisende. */
  dir: number;
  speed: number;
}

export interface WindSolution {
  /** Vindkorreksjonsvinkel, positiv = styr til høyre. */
  wca: number;
  heading: number;
  groundSpeed: number;
}

/** Løser vindtrekanten. Returnerer null om vinden er sterkere enn TAS på tvers. */
export function windTriangle(courseTrue: number, tas: number, wind: Wind): WindSolution | null {
  if (tas <= 0) return null;
  const rel = (wind.dir - courseTrue) * (Math.PI / 180);
  const sinWca = (wind.speed * Math.sin(rel)) / tas;
  if (Math.abs(sinWca) > 1) return null;
  const wcaRad = Math.asin(sinWca);
  const groundSpeed = tas * Math.cos(wcaRad) - wind.speed * Math.cos(rel);
  if (groundSpeed <= 0) return null;
  const wca = (wcaRad * 180) / Math.PI;
  return { wca, heading: norm360(courseTrue + wca), groundSpeed };
}

/** Motvind (+) / medvind (−) og sidevind (+ fra høyre) for en gitt retning. */
export function windComponents(directionDeg: number, wind: Wind): { head: number; cross: number } {
  const rel = norm180(wind.dir - directionDeg) * (Math.PI / 180);
  return { head: wind.speed * Math.cos(rel), cross: wind.speed * Math.sin(rel) };
}

export interface NavlogParams {
  tas: number;
  wind: Wind;
  /** Forbruk per time i flyets drivstoffenhet. */
  fuelBurn: number;
  altitudeFt: number;
  date?: Date;
  /** Vind per legg (f.eks. fra prognose). Mangler et legg, brukes `wind`. */
  legWinds?: (Wind | null | undefined)[];
}

export interface NavlogLeg {
  from: Waypoint;
  to: Waypoint;
  tc: number;
  /** Flyhøyde på legget (ft MSL). */
  altFt: number;
  wind: Wind;
  variation: number;
  mc: number;
  wca: number | null;
  th: number | null;
  mh: number | null;
  dist: number;
  gs: number | null;
  eteMin: number | null;
  fuel: number | null;
  cumDist: number;
  cumMin: number | null;
  cumFuel: number | null;
}

export function computeNavlog(wps: Waypoint[], p: NavlogParams): NavlogLeg[] {
  const legs: NavlogLeg[] = [];
  let cumDist = 0;
  let cumMin: number | null = 0;
  let cumFuel: number | null = 0;
  for (let i = 1; i < wps.length; i++) {
    const from = wps[i - 1];
    const to = wps[i];
    const tc = bearingTrue(from, to);
    const dist = distanceNm(from, to);
    const mid = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
    const variation = declination(mid, p.date);
    const wind = p.legWinds?.[i - 1] ?? p.wind;
    const altFt = legAltitude(wps, i, p.altitudeFt);
    const sol = windTriangle(tc, p.tas, wind);
    const eteMin = sol ? (dist / sol.groundSpeed) * 60 : null;
    const fuel = eteMin !== null ? (eteMin / 60) * p.fuelBurn : null;
    cumDist += dist;
    cumMin = cumMin !== null && eteMin !== null ? cumMin + eteMin : null;
    cumFuel = cumFuel !== null && fuel !== null ? cumFuel + fuel : null;
    legs.push({
      from,
      to,
      tc,
      altFt,
      wind,
      variation,
      mc: trueToMag(tc, variation),
      wca: sol?.wca ?? null,
      th: sol?.heading ?? null,
      mh: sol ? trueToMag(sol.heading, variation) : null,
      dist,
      gs: sol?.groundSpeed ?? null,
      eteMin,
      fuel,
      cumDist,
      cumMin,
      cumFuel,
    });
  }
  return legs;
}

/** Høyde for legget som ender i wps[i] (i ≥ 1). */
export const legAltitude = (wps: Waypoint[], i: number, defaultFt: number): number => wps[i]?.legAltFt ?? defaultFt;

/** Høyde per legg (lengde = antall legg). */
export const legAltitudes = (wps: Waypoint[], defaultFt: number): number[] =>
  wps.slice(1).map((_, k) => legAltitude(wps, k + 1, defaultFt));

/**
 * VFR-marsjhøyder etter SERA.5005/appendiks 3 (over 3000 ft AGL):
 * magnetisk track 000–179° → odde tusen + 500 ft, 180–359° → like tusen + 500 ft.
 */
export function vfrCruiseAltitudeOk(magTrack: number, altitudeFt: number): boolean {
  if (altitudeFt % 1000 !== 500) return false;
  const thousands = Math.floor(altitudeFt / 1000);
  const east = norm360(magTrack) < 180;
  return east ? thousands % 2 === 1 : thousands % 2 === 0;
}

/** Nærmeste korrekte VFR-marsjhøyde (≥ ønsket høyde). */
export function suggestVfrAltitude(magTrack: number, desiredFt: number): number {
  for (let alt = Math.max(3500, Math.floor(desiredFt / 1000) * 1000 + 500); alt < 20000; alt += 1000) {
    if (vfrCruiseAltitudeOk(magTrack, alt)) return alt;
  }
  return desiredFt;
}

export interface FuelPlan {
  trip: number;
  taxi: number;
  contingency: number;
  reserve: number;
  required: number;
  onBoard: number;
  extra: number;
  enduranceMin: number;
}

export function fuelPlan(o: {
  tripFuel: number;
  taxi: number;
  contingencyPct: number;
  reserveMin: number;
  burnPerHour: number;
  onBoard: number;
}): FuelPlan {
  const contingency = (o.tripFuel * o.contingencyPct) / 100;
  const reserve = (o.reserveMin / 60) * o.burnPerHour;
  const required = o.tripFuel + o.taxi + contingency + reserve;
  return {
    trip: o.tripFuel,
    taxi: o.taxi,
    contingency,
    reserve,
    required,
    onBoard: o.onBoard,
    extra: o.onBoard - required,
    enduranceMin: o.burnPerHour > 0 ? (Math.max(0, o.onBoard - o.taxi) / o.burnPerHour) * 60 : 0,
  };
}

export const fmtMin = (min: number | null): string => {
  if (min === null || !Number.isFinite(min)) return '—';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
