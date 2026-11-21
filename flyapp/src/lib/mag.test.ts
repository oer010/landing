import { describe, expect, it } from 'vitest';
import { declination } from './mag';

// Kontroll mot AIP Norge AD 2.2 (MAG VAR 2025 + årlig endring), avrundet til hele grader i AIP.
describe('misvisning (WMM 2025)', () => {
  const d = new Date('2026-11-21T12:00:00Z');
  it.each([
    ['ENGM', 60.1939, 11.1004, 5.3],
    ['ENBR', 60.2934, 5.2181, 3.3],
    ['ENTC', 69.6833, 18.9189, 11.4],
    ['ENKR', 69.7258, 29.8913, 17.3],
    ['ENVA', 63.4578, 10.924, 5.3],
  ])('%s innenfor AIP-avrundingen', (_id, lat, lon, aip) => {
    expect(Math.abs(declination({ lat, lon }, d) - aip)).toBeLessThanOrEqual(0.55);
  });
});
