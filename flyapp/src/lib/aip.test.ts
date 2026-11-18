import { describe, expect, it } from 'vitest';
import { cleanAipHtml, parseAd218 } from '../../scripts/aip.mjs';
import { applyAipFrequencies, buildDb } from './data';

// Forenklet utsnitt i samme struktur som Avinors eAIP.
const td = (inner: string) => `<td><p><span class="SD">${inner}</span><span class="sdParams" style="display: none;">TX;Y;1</span></p></td>`;
const html = `
<div id="ENKJ-AD-2.17"></div>
<div id="ENKJ-AD-2.18"><table><thead><tr><th>1</th></tr></thead><tbody>
<tr>${td('RADIO')}${td('Kjeller Radio')}${td('119.105 MHZ')}${td('HO')}${td('NIL')}</tr>
<tr>${td('')}${td('')}${td('<del class=" AmdtDeletedAIRAC">119.100 MHZ</del>')}${td('HO')}${td('')}</tr>
<tr>${td('APP')}${td('Oslo Approach')}${td('118.480 MHZ')}${td('H24')}${td('Oslo TMA sector E')}</tr>
<tr>${td('')}${td('')}${td('129.305 MHZ')}${td('HO')}${td('AVBL only when 118.480/120.455 MHZ U/S')}</tr>
<tr>${td('')}${td('')}${td('121.500 MHZ')}${td('H24')}${td('NIL')}</tr>
<tr>${td('')}${td('')}${td('243.000 MHZ')}${td('H24')}${td('NIL')}</tr>
</tbody></table></div>
<div id="ENKJ-AD-2.19"></div>`;

describe('AIP AD 2.18', () => {
  it('fjerner skjulte felt og strøket tekst', () => {
    expect(cleanAipHtml('<span class="sdParams" style="x">A;B;1</span>ok<del class=" AmdtDeletedAIRAC">gammel</del>')).toBe('ok');
  });
  it('tolker frekvenser og hopper over nød, UHF, reserver og strøkne', () => {
    const rows = parseAd218(html, 'ENKJ');
    expect(rows).toEqual([
      { svc: 'RADIO', call: 'Kjeller Radio', mhz: [119.105], hr: 'HO', rmk: '' },
      { svc: 'APP', call: 'Oslo Approach', mhz: [118.48], hr: 'H24', rmk: 'Oslo TMA sector E' },
    ]);
  });
  it('erstatter OurAirports-frekvenser med AIP', () => {
    const db = buildDb({
      generated: 'x',
      region: 'NO',
      navaids: [],
      airports: [['ENKJ', 'Kjeller', 'S', 59.97, 11.04, 354, 'NO', 'Lillestrøm', '', [], [['A/G', 'Kjeller', 119.1]]]],
    });
    applyAipFrequencies(db, { edition: '2026-09-03', airports: { ENKJ: parseAd218(html, 'ENKJ') } });
    const a = db.byIdent.get('ENKJ')!;
    expect(a.freqSource).toBe('AIP');
    expect(a.freqs.map((f) => [f.type, f.mhz])).toEqual([['RADIO', 119.105], ['APP', 118.48]]);
    expect(db.aipEdition).toBe('2026-09-03');
  });
});
