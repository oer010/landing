import { describe, expect, it } from 'vitest';
import { chartMode, latestAirac } from './aipstatus';

describe('AIP-status og kartlenker', () => {
  it('AIRAC-syklus på 28 dager', () => {
    expect(latestAirac(new Date('2026-11-26T08:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(latestAirac(new Date('2026-12-23T23:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(latestAirac(new Date('2026-12-24T01:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-24');
    expect(latestAirac(new Date('2026-11-20T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-29');
  });
  it('direkte lenke bare når utgaven er bekreftet gjeldende', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(chartMode('2026-11-26', { current: '2026-11-26', checkedAt: '2026-11-26T10:00:00Z' }, now)).toBe('direct');
    expect(chartMode('2026-09-03', { current: '2026-11-26', checkedAt: '2026-11-26T10:00:00Z' }, now)).toBe('avinor');
    // Ny AIRAC passert, ingen fersk sjekk: usikkert
    expect(chartMode('2026-09-03', { current: '2026-09-03', checkedAt: '2026-11-20T10:00:00Z' }, now)).toBe('avinor');
    // Utgaven er fra siste AIRAC: trygt selv uten status
    expect(chartMode('2026-11-26', null, now)).toBe('direct');
    // Ingen ny utgave ved AIRAC 24.12, bekreftet av jobben
    expect(chartMode('2026-11-26', { current: '2026-11-26', checkedAt: '2026-12-24T06:00:00Z' }, new Date('2026-12-24T12:00:00Z'))).toBe('direct');
  });
});
