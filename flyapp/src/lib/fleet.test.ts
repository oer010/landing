import { describe, expect, it } from 'vitest';
import { FLEET } from './fleet';
import { computeWB } from './wb';

const wb = (id: string, front: number, rear: number, bag: number, ext: [number, number], fuelKg: number, burnKg = 0) => {
  const ac = structuredClone(FLEET.find((a) => a.id === id)!);
  const w = [front, rear, bag, ext[0], ext[1], fuelKg];
  ac.stations.forEach((s, i) => (s.weight = w[i]));
  return computeWB({
    emptyWeight: ac.emptyWeight,
    emptyArm: ac.emptyArm,
    stations: ac.stations,
    envelope: ac.envelope,
    maxTakeoffWeight: ac.mtow,
    maxLandingWeight: ac.mlw,
    maxZeroFuelWeight: ac.mzfw,
    minWeight: ac.minWeight,
    limits: ac.limits,
    fuelBurnWeight: burnKg,
  });
};

describe('DA 40 NG-profiler', () => {
  it('regner som klubbens M&B-ark (LN-FTQ)', () => {
    // Arket: 928,04 kg @ 2,433 + forseter 170 + bakseter 80 + 118 kg drivstoff.
    const r = wb('ln-ftq', 170, 80, 0, [0, 0], 118, 25);
    expect(r.takeoff.weight).toBeCloseTo(1296.04, 2);
    expect(r.takeoff.cg).toBeCloseTo((928.04 * 2.433 + 170 * 2.3 + 80 * 3.25 + 118 * 2.63) / 1296.04, 6);
    expect(r.takeoff.withinEnvelope).toBe(true);
    expect(r.landing.weight).toBeCloseTo(1271.04, 2);
    expect(r.landing.overweight).toBe(false);
  });
  it('flagger for tung nese med to i front og fulle tanker', () => {
    const r = wb('ln-ftu', 180, 0, 0, [0, 0], 118);
    expect(r.takeoff.withinEnvelope).toBe(false);
  });
  it('sjekker bagasjegrenser og maks landingsvekt', () => {
    const r = wb('ln-ftq', 170, 160, 30, [10, 10], 118);
    expect(r.stationErrors.some((e) => e.startsWith('Utvidet bagasje'))).toBe(true);
    expect(r.takeoff.overweight).toBe(true);
    expect(r.landing.overweight).toBe(true);
  });
});
