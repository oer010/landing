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

import { findSymbols, gridFit } from '../../scripts/vfrsymbols.mjs';

describe('VFR-symboler', () => {
  // Trekant 8,7 × 7,5 pt; fylt = obligatorisk, åpen = på forespørsel. Fyll og kant kan være egne stier.
  const tri = (x: number, y: number, attrs: string) =>
    `<path ${attrs} d="M ${x} ${y} L ${x + 8.7} ${y} L ${x + 4.35} ${y - 7.5} Z" transform="matrix(1, 0, 0, 1, 0, 0)"/>`;
  const svg = `<svg><defs>${tri(0, 0, 'fill="rgb(0%, 0%, 0%)"')}</defs>
    ${tri(100, 100, 'fill="rgb(0%, 0%, 0%)"')}${tri(100, 100, 'fill="none" stroke="rgb(0%, 0%, 0%)"')}
    ${tri(200, 100, 'fill="none" stroke="rgb(0%, 0%, 0%)"')}
    <path fill="none" stroke="rgb(0%, 0%, 0%)" d="M 300 100 L 304 100 L 302 97 Z"/></svg>`;
  it('skiller fylte og åpne trekanter, og slår sammen fyll+kant', () => {
    const s = findSymbols(svg);
    expect(s).toHaveLength(2);
    expect(s.find((q: { x: number }) => q.x < 150)!.filled).toBe(true);
    expect(s.find((q: { x: number }) => q.x > 150)!.filled).toBe(false);
  });
  it('georefererer fra gradnettetiketter', () => {
    const w = (x: number, y: number, t: string) => ({ x0: x - 5, y0: y - 3, x1: x + 5, y1: y + 3, w: t });
    const g = gridFit([w(50, 100, "60°10'N"), w(50, 300, "60°00'N"), w(500, 110, "60°10'N"), w(100, 50, "010°50'E"), w(300, 50, "011°00'E"), w(110, 400, "010°50'E")])!;
    expect(g.toLL(50, 100).lat).toBeCloseTo(60 + 10 / 60, 4);
    expect(g.toLL(300, 50).lon).toBeCloseTo(11, 4);
  });
});
