import { describe, expect, it } from 'vitest';
import { latestByStation, obsTimeFromGroup, parseMetar } from './metparse';
import { categoryOf, decodeMetar } from './metar';

const now = new Date('2026-11-17T22:30:00Z');

describe('METAR-tolker (MET Norge-format)', () => {
  it('CAVOK', () => {
    const m = parseMetar('ENGM 172220Z 02007KT CAVOK M05/M06 Q0990=', now)!;
    expect(m.icaoId).toBe('ENGM');
    expect(m.wdir).toBe(20);
    expect(m.wspd).toBe(7);
    expect(m.temp).toBe(-5);
    expect(m.dewp).toBe(-6);
    expect(m.altim).toBe(990);
    expect(categoryOf(m)).toBe('VFR');
    expect(decodeMetar(m)).toContain('Sikt: ≥ 10 km');
    expect(new Date(m.obsTime * 1000).toISOString()).toBe('2026-11-17T22:20:00.000Z');
  });
  it('lavt skydekke og redusert sikt gir IFR', () => {
    const m = parseMetar('ENBR 171820Z 18015G28KT 3000 -RA BR BKN008 OVC015 08/07 Q1002 RMK WIND 1200FT', now)!;
    expect(m.wgst).toBe(28);
    expect(m.clouds).toEqual([{ cover: 'BKN', base: 800 }, { cover: 'OVC', base: 1500 }]);
    expect(categoryOf(m)).toBe('IFR');
    expect(decodeMetar(m)).toContain('Sikt: 3000 m');
  });
  it('MPS, VV, FEW/// og manglende duggpunkt', () => {
    const m = parseMetar('METAR UUEE 171800Z 27005MPS 0400 FG VV002 M02/ Q1015', now)!;
    expect(m.wspd).toBe(10);
    expect(m.clouds[0]).toEqual({ cover: 'VV', base: 200 });
    expect(m.dewp).toBeNull();
    expect(categoryOf(m)).toBe('LIFR');
    const f = parseMetar('ENSG 171850Z 09003KT 9999 FEW/// M07/M07 Q0990', now)!;
    expect(f.clouds[0]).toEqual({ cover: 'FEW', base: null });
    expect(categoryOf(f)).toBe('VFR');
  });
  it('ignorerer trendgrupper', () => {
    const m = parseMetar('ENZV 171750Z 24010KT 9999 SCT030 05/01 Q1000 TEMPO 2000 BKN005', now)!;
    expect(m.clouds).toHaveLength(1);
    expect(categoryOf(m)).toBe('VFR');
  });
  it('dato i forrige måned', () => {
    const t = obsTimeFromGroup('302350Z', new Date('2026-12-01T00:10:00Z'))!;
    expect(new Date(t * 1000).toISOString()).toBe('2026-11-30T23:50:00.000Z');
  });
  it('henter siste melding per stasjon', () => {
    const txt = 'ENGM 172150Z 03007KT CAVOK M04/M06 Q0990 NOSIG=\nENGM 172220Z 02007KT CAVOK M05/M06 Q0990=\nENZV 172220Z 02006KT CAVOK 02/M05 Q0986=\n\n';
    const r = latestByStation(txt);
    expect(r.get('ENGM')).toBe('ENGM 172220Z 02007KT CAVOK M05/M06 Q0990');
    expect(r.size).toBe(2);
    expect(latestByStation('TAF AMD ENBR 171700Z 1718/1818 VRB05KT CAVOK=').get('ENBR')).toContain('1718/1818');
  });
});
