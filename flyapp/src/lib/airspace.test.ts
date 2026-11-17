import { describe, expect, it } from 'vitest';
import { airacAgeDays, airspacesAlongRoute, airspacesAt, buildAirspaceDb, fmtLimits, kindOf, type Airspace } from './airspace';

const sq = (w: number, s: number, e: number, n: number): [number, number][] => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const as = (n: string, c: string, lo: number, hi: number, ring: [number, number][], extra: Partial<Airspace> = {}): Airspace => ({
  n, c, lo, hi, loFl: null, hiFl: null, f: null, notam: 0, amc: 0, src: null, g: [ring], ...extra,
});

const db = buildAirspaceDb({
  airac: '2026-09-03',
  generated: 'x',
  airspaces: [
    as('Gardermoen CTR', 'D', 0, 2500, sq(10.9, 60.1, 11.3, 60.35)),
    as('Oslo TMA 1', 'C', 2500, 19500, sq(10.5, 59.8, 11.6, 60.6), { hiFl: '195' }),
    as('Kjeller RMZ/TMZ', 'G', 0, 3000, sq(10.95, 59.9, 11.15, 60.05), { f: '119.100 MHZ' }),
    as('ENR104 Oslo', 'R', 0, 2000, sq(10.7, 59.9, 10.8, 59.95)),
    as('END357 Oppdal', 'Q', 0, 9500, sq(9.5, 62.5, 9.8, 62.7), { notam: 1 }),
  ],
});

describe('luftrom', () => {
  it('klassifiserer typer', () => {
    expect(kindOf({ n: 'Gardermoen CTR', c: 'D' })).toBe('CTR');
    expect(kindOf({ n: 'Kjeller RMZ/TMZ', c: 'G' })).toBe('RMZ');
    expect(kindOf({ n: 'Fagernes TIZ', c: 'G' })).toBe('TIZ');
    expect(kindOf({ n: 'ENR205 Bergen Fengsel', c: 'R' })).toBe('R');
    expect(kindOf({ n: 'END357 Oppdal', c: 'Q' })).toBe('D');
    expect(kindOf({ n: 'Bondalen S', c: 'Luftsport' })).toBe('SPORT');
  });
  it('formaterer høydegrenser', () => {
    expect(fmtLimits(db.airspaces[0])).toBe('GND – 2500 ft');
    expect(fmtLimits(db.airspaces[1])).toBe('2500 ft – FL 195');
  });
  it('finner luftrom over et punkt, lavest først', () => {
    const r = airspacesAt(db, { lat: 60.2, lon: 11.1 }).map((a) => a.n);
    expect(r).toEqual(['Gardermoen CTR', 'Oslo TMA 1']);
    expect(airspacesAt(db, { lat: 61, lon: 8 })).toEqual([]);
  });
  it('luftrom langs ruten i marsjhøyden', () => {
    const route = [{ lat: 59.97, lon: 11.04 }, { lat: 60.3, lon: 11.1 }];
    expect(airspacesAlongRoute(db, route, 1500).map((x) => x.airspace.n)).toEqual(['Kjeller RMZ/TMZ', 'Gardermoen CTR']);
    expect(airspacesAlongRoute(db, route, 3500).map((x) => x.airspace.n)).toEqual(['Oslo TMA 1']);
  });
  it('manglende øvre grense regnes som ukjent/ubegrenset', () => {
    const d2 = buildAirspaceDb({ airac: '', generated: '', airspaces: [as('ENR109 Romerike 1', 'R', 0, 0, sq(11, 60, 11.2, 60.1))] });
    expect(fmtLimits(d2.airspaces[0])).toBe('GND – øvre grense: se AIP');
    expect(airspacesAlongRoute(d2, [{ lat: 60.05, lon: 10.9 }, { lat: 60.05, lon: 11.3 }], 5500)).toHaveLength(1);
  });
  it('AIRAC-alder', () => {
    expect(airacAgeDays('2026-09-03', new Date('2026-11-17T12:00:00Z'))).toBe(75);
  });
});
