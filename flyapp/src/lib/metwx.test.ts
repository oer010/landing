import { describe, expect, it } from 'vitest';
import { activeWarnings, clipPolygon, parseIga, parseWarnings, warningAreas } from './metwx';

const RAW = `ZCZC
WANO31 ENMI 181634
ENOR AIRMET I06 VALID 181700/182000 ENMI-
ENOR POLARIS FIR MOD ICE FCST WI N6948 E02022 - N7103 E02241 - N7113
E02403 - N7120 E02650 - N7120 E02651 - N7052 E02951 - N6854 E02122 -
N6948 E02022 1500FT/FL120 MOV NW 10KT NC=

ZCZC
WWNO41 ENMI 181634
ENHV WS WRNG 02 181634 VALID 181700/182100
OCNL MOD TURB FCST INTSF=
`;

describe('MET-varsler', () => {
  const now = new Date('2026-11-18T17:30:00Z');
  it('tolker AIRMET med område og høyder', () => {
    const w = parseWarnings(RAW, now);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ kind: 'AIRMET', id: 'I06', fir: 'ENOR', lowerFt: 1500, upperFt: 12000 });
    expect(w[0].polygons[0]).toHaveLength(8);
    expect(w[0].polygons[0][0][0]).toBeCloseTo(69.8, 2);
    expect(w[0].to?.toISOString()).toBe('2026-11-18T20:00:00.000Z');
    expect(w[1]).toMatchObject({ kind: 'WS WRNG', fir: 'ENHV' });
    expect(activeWarnings(w, now)).toHaveLength(2);
    expect(activeWarnings(w, new Date('2026-11-18T20:30:00Z'))).toHaveLength(1);
  });
  it('tolker områdevarsel', () => {
    const f = parseIga('FBNO41', 'ZCZC\nFBNO41 ENMI 181500\nIGA PROG 181500-182400 UTC Nov 2026 POLARIS FIR SE PART\n\nWX.............: NIL\nVIS............: +10KM\n');
    expect(f.title).toMatch(/^181500-182400 UTC/);
    expect(f.text).toContain('VIS');
    expect(f.issued).toBe('181500');
  });
  it('hele FIR og halvplan klippes fra FIR-området', () => {
    const raw = `ZCZC
WSNO31 ENMI 191000
ENOR SIGMET A01 VALID 191000/191400 ENMI-
ENOR POLARIS FIR SEV TURB FCST N OF N6800 AND E OF E01500 SFC/FL150 STNR NC=
ZCZC
WSNO31 ENMI 191001
ENOR SIGMET A02 VALID 191000/191400 ENMI-
ENOR POLARIS FIR MOD MTW FCST ENTIRE FIR FL050/FL150 STNR NC=
`;
    const [a, b] = parseWarnings(raw, new Date('2026-11-19T11:00:00Z'));
    expect(a.phenomenon).toBe('SEV TURB');
    expect(a.firArea?.cuts).toEqual([{ dir: 'N', val: 68 }, { dir: 'E', val: 15 }]);
    expect(b.firArea?.entire).toBe(true);
    expect(b.phenomenon).toBe('MOD MTW');
    const fir: [number, number][][] = [[[60, 5], [72, 5], [72, 30], [60, 30]]];
    const area = warningAreas(a, fir)[0];
    expect(Math.min(...area.map((p) => p[0]))).toBeCloseTo(68, 6);
    expect(Math.min(...area.map((p) => p[1]))).toBeCloseTo(15, 6);
    expect(warningAreas(b, fir)[0]).toHaveLength(4);
    expect(clipPolygon([[60, 5], [72, 5], [72, 30], [60, 30]], { dir: 'S', val: 65 }).every((p) => p[0] <= 65)).toBe(true);
  });
});
