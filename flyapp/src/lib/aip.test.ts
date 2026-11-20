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

describe('AIP-telefonnumre', () => {
  it('finner tårn/AFIS, PPR og administrasjon med etikett', async () => {
    const { parsePhones } = await import('../../scripts/aip.mjs');
    const html = `<p>6 Administration Address Notodden Lufthavn AS 3676 Notodden Norge Telephone (+47) 35 02 60 70 Sentralbord / Switchboard (+47) 35 02 60 76 AFIS (+47) 35 02 60 71 Admin Fax NIL</p>
      <p>1.4 PPR required for all TFC, www.myppr.no or tel. +47 905 62 416. PPR number must be stated.</p>
      <p>If possible, call Karmoy TWR +47 52 83 07 19 , Flash LDG LGT.</p><p>FAX: +47 67 03 15 71</p><p>N 5912 E01045 postboks 2060</p>`;
    const p = parsePhones(html) as { kind: string; tel: string }[];
    expect(p.find((x) => x.tel === '+47 35 02 60 71')?.kind).toBe('atc');
    expect(p.find((x) => x.tel === '+47 52 83 07 19')?.kind).toBe('atc');
    expect(p.find((x) => x.tel === '+47 90 56 24 16')?.kind).toBe('ppr');
    expect(p.find((x) => x.tel === '+47 35 02 60 70')?.kind).toBe('admin');
    expect(p.some((x) => x.tel === '+47 67 03 15 71')).toBe(false);
    expect(p[0].kind).toBe('atc');
  });
});
