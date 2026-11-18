import { describe, expect, it } from 'vitest';
import { fmtDeg, runwayEnds } from './runway';

const rw = { le: '01L', he: '19R', lengthFt: 11811, widthFt: 148, surface: 'ASP', lighted: true, leEnd: null, heEnd: null, leHeadingTrue: null };

describe('rullebaneretning', () => {
  it('fra banenummer og misvisning', () => {
    const [a, b] = runwayEnds(rw, 4);
    expect(a.magHdg).toBe(10);
    expect(a.trueHdg).toBe(14);
    expect(b.magHdg).toBe(190);
  });
  it('fra kurs i databasen', () => {
    const [a, b] = runwayEnds({ ...rw, leHeadingTrue: 15.5 }, 4);
    expect(fmtDeg(a.magHdg)).toBe('012°');
    expect(fmtDeg(b.magHdg)).toBe('192°');
    expect(fmtDeg(360)).toBe('360°');
    expect(fmtDeg(0.2)).toBe('360°');
  });
});
