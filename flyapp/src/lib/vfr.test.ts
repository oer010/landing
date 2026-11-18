import { describe, expect, it } from 'vitest';
import { isVfrChart, parseChartPoints } from '../../scripts/vfr.mjs';

describe('VFR-punkter fra kart', () => {
  it('leser navn og koordinater fra tabell', () => {
    const t = `
      MIDTØY                     1726595100N 0111100E          R108
      NITTEDAL                           600300N         0105300E
      NYLAND 1129 581000N 0080000E
      GND 600000N 0110000E
      L 2 1 A 591000N 0100000E`;
    const p = parseChartPoints(t);
    expect(p.map((x) => x.n)).toEqual(['MIDTØY', 'NITTEDAL', 'NYLAND']);
    expect(p[0].lat).toBeCloseTo(59 + 51 / 60, 6);
    expect(p[0].lon).toBeCloseTo(11 + 11 / 60, 6);
  });
  it('kjenner igjen rene VFR-kart', () => {
    expect(isVfrChart('VFR - Routes')).toBe(true);
    expect(isVfrChart('VFR-Routes Light Aircraft')).toBe(true);
    expect(isVfrChart('Visual Approach Chart - ICAO')).toBe(false);
  });
});
