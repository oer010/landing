// Masse og balanse. Enhetsuavhengig: bruk samme enhet (kg/m eller lb/in) overalt.

export interface Station {
  name: string;
  arm: number;
  weight: number;
  max?: number;
  /** Drivstofftank: vekt beregnes fra volum × tetthet. */
  fuel?: boolean;
}

export interface EnvelopePoint {
  arm: number;
  weight: number;
}

export interface WBInput {
  emptyWeight: number;
  emptyArm: number;
  stations: Station[];
  envelope: EnvelopePoint[];
  maxTakeoffWeight: number;
  maxLandingWeight?: number;
  maxZeroFuelWeight?: number;
  minWeight?: number;
  limits?: { name: string; stations: string[]; max: number }[];
  /** Drivstoff brukt på turen (vekt), trekkes fra drivstoffstasjonene for landingstilstand. */
  fuelBurnWeight?: number;
}

export interface WBState {
  weight: number;
  moment: number;
  cg: number;
  withinEnvelope: boolean;
  overweight: boolean;
}

export interface WBResult {
  takeoff: WBState;
  landing: WBState;
  stationErrors: string[];
}

function state(weight: number, moment: number, env: EnvelopePoint[], mtow: number): WBState {
  const cg = weight > 0 ? moment / weight : 0;
  return {
    weight,
    moment,
    cg,
    withinEnvelope: env.length >= 3 ? pointInPolygon({ arm: cg, weight }, env) : true,
    overweight: weight > mtow,
  };
}

export function computeWB(i: WBInput): WBResult {
  let w = i.emptyWeight;
  let m = i.emptyWeight * i.emptyArm;
  const errors: string[] = [];
  let fuelArmSum = 0;
  let fuelWeight = 0;
  for (const s of i.stations) {
    w += s.weight;
    m += s.weight * s.arm;
    if (s.max !== undefined && s.weight > s.max) errors.push(`${s.name}: ${s.weight} > maks ${s.max}`);
    if (s.fuel) {
      fuelArmSum += s.weight * s.arm;
      fuelWeight += s.weight;
    }
  }
  for (const l of i.limits ?? []) {
    const sum = i.stations.filter((s) => l.stations.includes(s.name)).reduce((a, s) => a + s.weight, 0);
    if (sum > l.max) errors.push(`${l.name}: ${sum} > maks ${l.max}`);
  }
  const takeoff = state(w, m, i.envelope, i.maxTakeoffWeight);
  const burn = Math.min(i.fuelBurnWeight ?? 0, fuelWeight);
  const fuelArm = fuelWeight > 0 ? fuelArmSum / fuelWeight : 0;
  const landing = state(w - burn, m - burn * fuelArm, i.envelope, i.maxLandingWeight ?? i.maxTakeoffWeight);
  const zeroFuel = w - fuelWeight;
  if (i.maxZeroFuelWeight && zeroFuel > i.maxZeroFuelWeight) errors.push(`Vekt uten drivstoff ${Math.round(zeroFuel)} > maks ${i.maxZeroFuelWeight}`);
  if (i.minWeight && landing.weight < i.minWeight) errors.push(`Vekt ved landing ${Math.round(landing.weight)} < minste flyvekt ${i.minWeight}`);
  return { takeoff, landing, stationErrors: errors };
}

/** Ray casting. Punkter på kanten regnes som innenfor. */
export function pointInPolygon(p: EnvelopePoint, poly: EnvelopePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (onSegment(p, a, b)) return true;
    if (a.weight > p.weight !== b.weight > p.weight) {
      const x = ((b.arm - a.arm) * (p.weight - a.weight)) / (b.weight - a.weight) + a.arm;
      if (p.arm < x) inside = !inside;
    }
  }
  return inside;
}

function onSegment(p: EnvelopePoint, a: EnvelopePoint, b: EnvelopePoint): boolean {
  const cross = (p.arm - a.arm) * (b.weight - a.weight) - (p.weight - a.weight) * (b.arm - a.arm);
  if (Math.abs(cross) > 1e-9 * Math.max(1, Math.abs(b.arm - a.arm) * Math.abs(b.weight - a.weight))) return false;
  return (
    Math.min(a.arm, b.arm) - 1e-9 <= p.arm &&
    p.arm <= Math.max(a.arm, b.arm) + 1e-9 &&
    Math.min(a.weight, b.weight) - 1e-9 <= p.weight &&
    p.weight <= Math.max(a.weight, b.weight) + 1e-9
  );
}
