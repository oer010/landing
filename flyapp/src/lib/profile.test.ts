import { describe, expect, it } from 'vitest';
import { computeNavlog, type Waypoint } from './navlog';
import { computeProfile, PATTERN_AGL } from './profile';

const perf = { climbTas: 70, climbFpm: 700, climbBurn: 40, descentTas: 100, descentFpm: 500, descentBurn: 20, cruiseTas: 100, cruiseBurn: 30 };
const calm = { dir: 0, speed: 0 };

describe('klatre-/nedstigningsprofil', () => {
  const wps: Waypoint[] = [
    { id: 'A', kind: 'airport', lat: 60, lon: 10, elevFt: 0 },
    { id: 'B', kind: 'airport', lat: 61, lon: 10, elevFt: 500 },
  ];
  const legs = computeNavlog(wps, { tas: 100, wind: calm, fuelBurn: 30, altitudeFt: 3500, date: new Date('2026-06-01') });
  const p = computeProfile(wps, legs, perf);

  it('lager TOC, marsj til TOD og nedstigning', () => {
    expect(p.rows.map((r) => [r.kind, r.label])).toEqual([
      ['climb', 'TOC 3500'],
      ['cruise', 'TOD'],
      ['descent', 'B'],
    ]);
  });
  it('regner klatredistanse og -tid riktig', () => {
    const c = p.rows[0];
    expect(c.eteMin).toBeCloseTo(3500 / 700, 6); // 5 min
    expect(c.dist).toBeCloseTo((70 * 5) / 60, 6);
    expect(c.fuel).toBeCloseTo((5 / 60) * 40, 6);
  });
  it('går ned til trafikkrundehøyde over destinasjonen', () => {
    const d = p.rows[2];
    expect(d.altTo).toBe(500 + PATTERN_AGL);
    expect(d.eteMin).toBeCloseTo((3500 - 1500) / 500, 6); // 4 min
  });
  it('total distanse er uendret, tid lengre enn ren marsj', () => {
    expect(p.totalDist).toBeCloseTo(legs[0].dist, 6);
    expect(p.totalMin!).toBeGreaterThan(legs[0].eteMin!);
    expect(p.climbMin).toBeCloseTo(5, 6);
    expect(p.descentMin).toBeCloseTo(4, 6);
  });
  it('høydeendring mellom legg og for kort legg gir advarsel', () => {
    const w3: Waypoint[] = [
      { id: 'A', kind: 'airport', lat: 60, lon: 10, elevFt: 0 },
      { id: 'X', kind: 'user', lat: 60.02, lon: 10 },
      { id: 'B', kind: 'airport', lat: 61, lon: 10, elevFt: 0, legAltFt: 5500 },
    ];
    const l3 = computeNavlog(w3, { tas: 100, wind: calm, fuelBurn: 30, altitudeFt: 4500 });
    const p3 = computeProfile(w3, l3, perf);
    expect(p3.warnings.length).toBe(1);
    expect(p3.rows.some((r) => r.kind === 'climb' && r.label === 'TOC 5500')).toBe(true);
    expect(p3.totalDist).toBeCloseTo(l3[0].dist + l3[1].dist, 6);
  });
});
