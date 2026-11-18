import { describe, expect, it } from 'vitest';
import { geometryFromText, notamKind, notamShapes, notamStatus, parseNotam } from './notam';

const R = `A2345/26 NOTAMN
Q) ENOR/QRTCA/IV/BO/W/000/045/6005N01120E005
A) ENOR B) 2611180800 C) 2611181600
E) TEMPORARY RESTRICTED AREA ENR 102 ACTIVATED WI AREA:
600000N 0110000E - 601000N 0112000E - 600500N 0114000E - 600000N 0110000E
F) GND G) 4500FT AMSL`;

describe('NOTAM', () => {
  it('tolker Q-linje, tider, høyder og polygon', () => {
    const n = parseNotam({ loc: 'ENOR', msg: R })!;
    expect(n.id).toBe('A2345/26');
    expect(n.code).toBe('QRTCA');
    expect(n.from?.toISOString()).toBe('2026-11-18T08:00:00.000Z');
    expect(n.to?.toISOString()).toBe('2026-11-18T16:00:00.000Z');
    expect(n.lowerFt).toBe(0);
    expect(n.upperFt).toBe(4500);
    expect(n.geoms).toHaveLength(1);
    expect(n.geoms[0].type).toBe('polygon');
    expect((n.geoms[0] as { pts: unknown[] }).pts).toHaveLength(3);
    expect(notamKind(n)).toBe('restriction');
    expect(notamStatus(n, new Date('2026-11-18T07:00:00Z'))).toBe('upcoming');
    expect(notamStatus(n, new Date('2026-11-18T09:00:00Z'))).toBe('active');
    expect(notamStatus(n, new Date('2026-11-18T17:00:00Z'))).toBe('expired');
  });
  it('sirkel med radius og hinderpunkt', () => {
    const g = geometryFromText('UAS OPS WI RADIUS 1NM CENTRED ON 595410N 0104230E. ALSO CRANE 593001N 0102002E HGT 150FT');
    expect(g[0]).toMatchObject({ type: 'circle', rNm: 1 });
    expect(g[1]).toMatchObject({ type: 'point' });
    expect((g[0] as { lat: number }).lat).toBeCloseTo(59.9028, 3);
  });
  it('faller tilbake på Q-sirkel og PERM', () => {
    const n = parseNotam({ loc: 'ENGM', msg: 'A0001/26 NOTAMN\nQ) ENOR/QMRLC/IV/NBO/A/000/999/6012N01105E005\nA) ENGM B) 2611010000 C) PERM\nE) RWY 01L/19R CLSD' })!;
    expect(n.perm).toBe(true);
    expect(n.to).toBeNull();
    expect(notamShapes(n)[0]).toMatchObject({ type: 'circle', rNm: 5 });
    expect(notamKind(n)).toBe('aerodrome');
  });
});
