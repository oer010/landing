import { describe, expect, it } from 'vitest';
import { landingDistance, pressureAltitude, takeoffDistance } from './da40perf';

const base = { headwindKt: 0, surface: 'paved' as const, wet: false, slopePct: 0 };

describe('DA 40 NG start/landing (AFM 5.3.7/5.3.12)', () => {
  it('treffer tabellverdiene eksakt', () => {
    expect(takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 0, oatC: 0 })).toMatchObject({ groundRollM: 365, over50ftM: 550 });
    expect(takeoffDistance({ ...base, massKg: 1200, pressureAltFt: 2000, oatC: 20 })).toMatchObject({ groundRollM: 415, over50ftM: 610 });
    expect(landingDistance({ ...base, massKg: 1280, pressureAltFt: 1000, oatC: 10 })).toMatchObject({ groundRollM: 320, over50ftM: 650 });
  });
  it('interpolerer mellom masse, høyde og temperatur', () => {
    const r = takeoffDistance({ ...base, massKg: 1240, pressureAltFt: 500, oatC: 15 });
    expect(r.groundRollM).toBeGreaterThan(345);
    expect(r.groundRollM).toBeLessThan(435);
  });
  it('vind og underlag', () => {
    const r0 = takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 0, oatC: 10 });
    const hw = takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 0, oatC: 10, headwindKt: 12 });
    const tw = takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 0, oatC: 10, headwindKt: -2 });
    expect(hw.over50ftM).toBeCloseTo(r0.over50ftM * 0.9, 0);
    expect(tw.over50ftM).toBeCloseTo(r0.over50ftM * 1.1, 0);
    const g = takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 0, oatC: 10, surface: 'grass-medium' });
    expect(g.groundRollM).toBe(Math.round(385 * 1.3));
  });
  it('utenfor tabellen og trykkhøyde', () => {
    expect(takeoffDistance({ ...base, massKg: 1310, pressureAltFt: 10000, oatC: 45 }).outsideTable).toBe(true);
    expect(pressureAltitude(681, 1003)).toBe(958);
  });
});
