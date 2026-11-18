// Vertikalprofil for navloggen: klatring fra avgang, høydeendringer mellom legg,
// marsj, og nedstigning til trafikkrundehøyde over destinasjonen.

import { bearingTrue, destination, distanceNm, type LatLon } from './geo';
import { trueToMag } from './mag';
import { windTriangle, type NavlogLeg, type Waypoint, type Wind } from './navlog';

export interface ClimbDescentPerf {
  /** TAS under klatring (kt), stigehastighet (ft/min), forbruk (enhet/t). */
  climbTas: number;
  climbFpm: number;
  climbBurn: number;
  descentTas: number;
  descentFpm: number;
  descentBurn: number;
  cruiseTas: number;
  cruiseBurn: number;
}

export type ProfileKind = 'climb' | 'cruise' | 'descent';

export interface ProfileRow {
  kind: ProfileKind;
  legIndex: number;
  /** Navn på punktet raden ender i: veipunkt, «TOC» eller «TOD». */
  label: string;
  end: LatLon;
  altFrom: number;
  altTo: number;
  tc: number;
  mc: number;
  wca: number | null;
  mh: number | null;
  wind: Wind;
  dist: number;
  gs: number | null;
  eteMin: number | null;
  fuel: number | null;
  cumDist: number;
  cumMin: number | null;
  cumFuel: number | null;
}

export interface Profile {
  rows: ProfileRow[];
  /** Legg der klatring/nedstigning ikke rekker å bli ferdig. */
  warnings: string[];
  totalDist: number;
  totalMin: number | null;
  totalFuel: number | null;
  climbMin: number;
  descentMin: number;
}

/** Trafikkrundehøyde over destinasjonen som nedstigningen ender i. */
export const PATTERN_AGL = 1000;

function segment(tc: number, tas: number, wind: Wind, distNm: number, burn: number) {
  const sol = windTriangle(tc, tas, wind);
  const gs = sol?.groundSpeed ?? null;
  const eteMin = gs ? (distNm / gs) * 60 : null;
  return { sol, gs, eteMin, fuel: eteMin !== null ? (eteMin / 60) * burn : null };
}

/** Distanse (NM) for en høydeendring med gitt fart og vertikalfart. */
function vertDist(dAlt: number, fpm: number, tc: number, tas: number, wind: Wind): number {
  const sol = windTriangle(tc, tas, wind);
  const gs = sol?.groundSpeed ?? tas;
  return ((Math.abs(dAlt) / Math.max(1, fpm)) / 60) * gs;
}

export function computeProfile(
  wps: Waypoint[],
  legs: NavlogLeg[],
  perf: ClimbDescentPerf,
  opts: { depElevFt?: number | null; destElevFt?: number | null } = {},
): Profile {
  const rows: ProfileRow[] = [];
  const warnings: string[] = [];
  const dep = opts.depElevFt ?? wps[0]?.elevFt ?? 0;
  const dest = opts.destElevFt ?? wps[wps.length - 1]?.elevFt ?? 0;
  let cumDist = 0;
  let cumMin: number | null = 0;
  let cumFuel: number | null = 0;
  let climbMin = 0;
  let descentMin = 0;

  const push = (r: Omit<ProfileRow, 'cumDist' | 'cumMin' | 'cumFuel'>) => {
    cumDist += r.dist;
    cumMin = cumMin !== null && r.eteMin !== null ? cumMin + r.eteMin : null;
    cumFuel = cumFuel !== null && r.fuel !== null ? cumFuel + r.fuel : null;
    if (r.kind === 'climb' && r.eteMin) climbMin += r.eteMin;
    if (r.kind === 'descent' && r.eteMin) descentMin += r.eteMin;
    rows.push({ ...r, cumDist, cumMin, cumFuel });
  };

  legs.forEach((leg, i) => {
    const isLast = i === legs.length - 1;
    const startAlt = i === 0 ? dep : legs[i - 1].altFt;
    const target = leg.altFt;
    const endAlt = isLast ? Math.min(target, dest + PATTERN_AGL) : target;
    const tc = leg.tc;
    const wind = leg.wind;
    const brg = bearingTrue(leg.from, leg.to);
    const legDist = distanceNm(leg.from, leg.to);

    // Høydeendring i starten av legget (klatring fra avgang, eller endring mellom legg).
    const dStart = target - startAlt;
    const startKind: ProfileKind | null = dStart > 50 ? 'climb' : dStart < -50 ? 'descent' : null;
    let dStartNm = 0;
    if (startKind === 'climb') dStartNm = vertDist(dStart, perf.climbFpm, tc, perf.climbTas, wind);
    if (startKind === 'descent') dStartNm = vertDist(dStart, perf.descentFpm, tc, perf.descentTas, wind);

    // Nedstigning mot destinasjonen på siste legg.
    const dEnd = endAlt - target;
    let dEndNm = isLast && dEnd < -50 ? vertDist(dEnd, perf.descentFpm, tc, perf.descentTas, wind) : 0;

    if (dStartNm + dEndNm > legDist) {
      warnings.push(
        `${leg.to.id}: legget (${legDist.toFixed(1)} NM) er for kort til å ${startKind === 'climb' ? `klatre til ${target} ft` : 'endre høyde'}${dEndNm ? ' og gå ned igjen' : ''} – vurder lavere høyde`,
      );
      const scale = legDist / (dStartNm + dEndNm);
      dStartNm *= scale;
      dEndNm *= scale;
    }
    const cruiseNm = Math.max(0, legDist - dStartNm - dEndNm);
    const mag = (t: number) => trueToMag(t, leg.variation);
    const rowBase = (wca: number | null) => ({
      legIndex: i,
      tc,
      mc: leg.mc,
      wca,
      mh: wca === null ? null : mag(tc + wca),
      wind,
    });

    let along = 0;
    if (startKind && dStartNm > 0.05) {
      const tas = startKind === 'climb' ? perf.climbTas : perf.descentTas;
      const burn = startKind === 'climb' ? perf.climbBurn : perf.descentBurn;
      const s = segment(tc, tas, wind, dStartNm, burn);
      along += dStartNm;
      push({
        ...rowBase(s.sol?.wca ?? null),
        kind: startKind,
        label: startKind === 'climb' ? `TOC ${target}` : `↘ ${target}`,
        end: destination(leg.from, brg, along),
        altFrom: startAlt,
        altTo: target,
        dist: dStartNm,
        gs: s.gs,
        eteMin: s.eteMin,
        fuel: s.fuel,
      });
    }
    if (cruiseNm > 0.05 || (!dEndNm && !(startKind && dStartNm > 0.05))) {
      const s = segment(tc, perf.cruiseTas, wind, cruiseNm, perf.cruiseBurn);
      along += cruiseNm;
      push({
        ...rowBase(s.sol?.wca ?? null),
        kind: 'cruise',
        label: dEndNm > 0.05 ? 'TOD' : leg.to.id,
        end: dEndNm > 0.05 ? destination(leg.from, brg, along) : leg.to,
        altFrom: target,
        altTo: target,
        dist: cruiseNm,
        gs: s.gs,
        eteMin: s.eteMin,
        fuel: s.fuel,
      });
    }
    if (dEndNm > 0.05) {
      const s = segment(tc, perf.descentTas, wind, dEndNm, perf.descentBurn);
      push({
        ...rowBase(s.sol?.wca ?? null),
        kind: 'descent',
        label: leg.to.id,
        end: leg.to,
        altFrom: target,
        altTo: endAlt,
        dist: dEndNm,
        gs: s.gs,
        eteMin: s.eteMin,
        fuel: s.fuel,
      });
    }
  });

  return { rows, warnings, totalDist: cumDist, totalMin: cumMin, totalFuel: cumFuel, climbMin, descentMin };
}
