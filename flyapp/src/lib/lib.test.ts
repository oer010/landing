import { describe, expect, it } from 'vitest';
import { bearingTrue, crossTrackNm, destination, distanceNm, formatIcaoCoord, formatLatLon, parseCoordinate } from './geo';
import { declination, trueToMag } from './mag';
import { computeNavlog, fuelPlan, suggestVfrAltitude, vfrCruiseAltitudeOk, windComponents, windTriangle, type Waypoint } from './navlog';
import { densityAltitude, pressureAltitude, trueAirspeed } from './e6b';
import { computeWB, pointInPolygon } from './wb';
import { isNight, sunTimes } from './sun';
import { categoryOf, ceilingFt, flightCategory, visibilitySm, type Metar } from './metar';
import { fplFileName, routeToFpl, routeToGpx, icaoFlightPlan } from './export';
import { exampleAircraft } from './store';
import { buildDb, nearestAirports, searchAirports } from './data';
import { parseCsv } from '../../scripts/build-data.mjs';

const ENGM = { lat: 60.2028, lon: 11.0839 };
const ENBR = { lat: 60.2934, lon: 5.2181 };

describe('geo', () => {
  it('beregner avstand Gardermoen–Flesland (~175 NM)', () => {
    expect(distanceNm(ENGM, ENBR)).toBeCloseTo(174.8, 1);
  });
  it('beregner kurs vestover', () => {
    expect(bearingTrue(ENGM, ENBR)).toBeGreaterThan(270);
    expect(bearingTrue(ENGM, ENBR)).toBeLessThan(276);
  });
  it('destination er inversen av distance/bearing', () => {
    const p = destination(ENGM, 123, 50);
    expect(distanceNm(ENGM, p)).toBeCloseTo(50, 6);
    expect(bearingTrue(ENGM, p)).toBeCloseTo(123, 6);
  });
  it('cross-track er positiv til høyre', () => {
    const a = { lat: 60, lon: 10 };
    const b = { lat: 61, lon: 10 };
    expect(crossTrackNm(a, b, { lat: 60.5, lon: 10.1 })).toBeGreaterThan(0);
    expect(crossTrackNm(a, b, { lat: 60.5, lon: 9.9 })).toBeLessThan(0);
  });
  it('tolker koordinatformater', () => {
    expect(parseCoordinate('5959N01030E')).toEqual({ lat: 59 + 59 / 60, lon: 10.5 });
    expect(parseCoordinate('595930N0103000W')!.lon).toBeCloseTo(-10.5, 6);
    expect(parseCoordinate('59.5, 10.25')).toEqual({ lat: 59.5, lon: 10.25 });
    expect(parseCoordinate("N59°30.0' E010°15.0'")).toEqual({ lat: 59.5, lon: 10.25 });
    expect(parseCoordinate('ENGM')).toBeNull();
    expect(parseCoordinate('95.0,10')).toBeNull();
  });
  it('formaterer koordinater', () => {
    expect(formatLatLon({ lat: 59.5, lon: -10.25 })).toBe("N59°30.00' W010°15.00'");
    expect(formatIcaoCoord({ lat: 59.9999, lon: 10.5 })).toBe('6000N01030E');
  });
});

describe('magnetisk misvisning', () => {
  it('gir østlig misvisning i Sør-Norge (WMM2025)', () => {
    const d = declination(ENGM, new Date('2026-06-01'));
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(8);
    expect(trueToMag(90, d)).toBeCloseTo(90 - d, 6);
  });
});

describe('vindtrekant', () => {
  it('ren motvind', () => {
    const s = windTriangle(360, 100, { dir: 360, speed: 20 })!;
    expect(s.groundSpeed).toBeCloseTo(80, 6);
    expect(s.wca).toBeCloseTo(0, 6);
  });
  it('sidevind fra høyre gir korreksjon til høyre', () => {
    const s = windTriangle(360, 100, { dir: 90, speed: 20 })!;
    expect(s.wca).toBeCloseTo(11.54, 1);
    expect(s.heading).toBeCloseTo(11.54, 1);
    expect(s.groundSpeed).toBeCloseTo(97.98, 1);
  });
  it('umulig vind gir null', () => {
    expect(windTriangle(0, 50, { dir: 90, speed: 60 })).toBeNull();
  });
  it('vindkomponenter', () => {
    const c = windComponents(270, { dir: 300, speed: 20 });
    expect(c.head).toBeCloseTo(17.32, 1);
    expect(c.cross).toBeCloseTo(10, 1);
  });
});

describe('navlogg', () => {
  const wps: Waypoint[] = [
    { id: 'ENGM', kind: 'airport', ...ENGM },
    { id: 'WP1', kind: 'user', lat: 60.5, lon: 9 },
    { id: 'ENBR', kind: 'airport', ...ENBR },
  ];
  it('summerer distanse, tid og drivstoff', () => {
    const legs = computeNavlog(wps, { tas: 100, wind: { dir: 0, speed: 0 }, fuelBurn: 30, altitudeFt: 5500, date: new Date('2026-06-01') });
    expect(legs).toHaveLength(2);
    const total = legs[0].dist + legs[1].dist;
    expect(legs[1].cumDist).toBeCloseTo(total, 6);
    expect(legs[1].cumMin!).toBeCloseTo((total / 100) * 60, 6);
    expect(legs[1].cumFuel!).toBeCloseTo((total / 100) * 30, 6);
    expect(legs[0].mh!).toBeCloseTo(legs[0].mc, 6);
  });
  it('halvsirkelregelen for VFR', () => {
    expect(vfrCruiseAltitudeOk(90, 5500)).toBe(true);
    expect(vfrCruiseAltitudeOk(90, 4500)).toBe(false);
    expect(vfrCruiseAltitudeOk(270, 4500)).toBe(true);
    expect(vfrCruiseAltitudeOk(270, 4000)).toBe(false);
    expect(suggestVfrAltitude(270, 5000)).toBe(6500);
    expect(suggestVfrAltitude(10, 3000)).toBe(3500);
  });
  it('drivstoffplan', () => {
    const f = fuelPlan({ tripFuel: 60, taxi: 5, contingencyPct: 5, reserveMin: 30, burnPerHour: 30, onBoard: 120 });
    expect(f.required).toBeCloseTo(60 + 5 + 3 + 15, 6);
    expect(f.extra).toBeCloseTo(120 - 83, 6);
    expect(f.enduranceMin).toBeCloseTo(230, 6);
  });
});

describe('E6B', () => {
  it('trykkhøyde', () => {
    expect(pressureAltitude(0, 1013.25)).toBeCloseTo(0, 3);
    expect(pressureAltitude(1000, 1003)).toBeCloseTo(1281, -1);
  });
  it('tetthetshøyde i varme', () => {
    expect(densityAltitude(0, 15)).toBeCloseTo(0, 6);
    expect(densityAltitude(2000, 30)).toBeCloseTo(2000 + 118.8 * (30 - 11.04), 3);
  });
  it('TAS øker med høyde', () => {
    expect(trueAirspeed(100, 0, 15)).toBeCloseTo(100, 3);
    const tas = trueAirspeed(100, 8000, -1);
    expect(tas).toBeGreaterThan(111);
    expect(tas).toBeLessThan(114);
  });
});

describe('masse og balanse', () => {
  it('eksempelflyet er innenfor', () => {
    const ac = exampleAircraft();
    const r = computeWB({ emptyWeight: ac.emptyWeight, emptyArm: ac.emptyArm, stations: ac.stations, envelope: ac.envelope, maxTakeoffWeight: ac.mtow, fuelBurnWeight: 40 });
    expect(r.takeoff.weight).toBeCloseTo(750 + 160 + 10 + 108, 6);
    expect(r.takeoff.withinEnvelope).toBe(true);
    expect(r.landing.weight).toBeCloseTo(r.takeoff.weight - 40, 6);
    expect(r.landing.cg).toBeLessThan(r.takeoff.cg);
  });
  it('oppdager overvekt og stasjonsgrenser', () => {
    const r = computeWB({ emptyWeight: 1000, emptyArm: 1, stations: [{ name: 'Bagasje', arm: 2, weight: 200, max: 50 }], envelope: [], maxTakeoffWeight: 1100 });
    expect(r.takeoff.overweight).toBe(true);
    expect(r.stationErrors).toHaveLength(1);
  });
  it('punkt-i-polygon inkl. kant', () => {
    const sq = [{ arm: 0, weight: 0 }, { arm: 0, weight: 10 }, { arm: 10, weight: 10 }, { arm: 10, weight: 0 }];
    expect(pointInPolygon({ arm: 5, weight: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ arm: 10, weight: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ arm: 11, weight: 5 }, sq)).toBe(false);
  });
});

describe('sol', () => {
  it('soloppgang/-nedgang i Oslo ved jevndøgn ~06:xx/18:xx lokal (04–05/16–17 UTC)', () => {
    const s = sunTimes(new Date('2026-03-20T12:00:00Z'), 59.91, 10.75);
    expect(s.polar).toBe('normal');
    expect(s.sunrise!.getUTCHours()).toBe(5);
    expect(s.sunset!.getUTCHours()).toBe(17);
    expect(s.civilDusk!.getTime()).toBeGreaterThan(s.sunset!.getTime());
  });
  it('midnattssol og mørketid i Tromsø', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 69.68, 18.92).polar).toBe('midnight-sun');
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.68, 18.92).polar).toBe('polar-night');
    expect(isNight(new Date('2026-06-21T23:30:00Z'), 69.68, 18.92)).toBe(false);
  });
  it('natt over Oslo midt på vinternatta', () => {
    expect(isNight(new Date('2026-12-21T23:00:00Z'), 59.91, 10.75)).toBe(true);
    expect(isNight(new Date('2026-12-21T11:00:00Z'), 59.91, 10.75)).toBe(false);
  });
});

describe('METAR', () => {
  it('tolker sikt og tak', () => {
    expect(visibilitySm('6+')).toBe(6);
    expect(visibilitySm('1 1/2')).toBe(1.5);
    expect(visibilitySm('3/4')).toBe(0.75);
    expect(ceilingFt([{ cover: 'FEW', base: 800 }, { cover: 'BKN', base: 2500 }, { cover: 'OVC', base: 4000 }])).toBe(2500);
  });
  it('flygekategori', () => {
    expect(flightCategory(10, null)).toBe('VFR');
    expect(flightCategory(4, null)).toBe('MVFR');
    expect(flightCategory(10, 800)).toBe('IFR');
    expect(flightCategory(0.5, null)).toBe('LIFR');
    const m = { visib: '6+', clouds: [{ cover: 'BKN', base: 2000 }] } as unknown as Metar;
    expect(categoryOf(m)).toBe('MVFR');
  });
});

describe('eksport', () => {
  const wps: Waypoint[] = [
    { id: 'ENKJ', kind: 'airport', lat: 59.97, lon: 11.04, name: 'Kjeller' },
    { id: 'Fjell & dal', kind: 'user', lat: 60.5, lon: 9.5 },
    { id: 'ENBR', kind: 'airport', lat: 60.29, lon: 5.22 },
  ];
  it('GPX er gyldig XML med escaping', () => {
    const g = routeToGpx('Test <1>', wps);
    expect(g).toContain('<name>Test &lt;1&gt;</name>');
    expect(g).toContain('<name>FJELLD</name>');
    expect(g.match(/<rtept/g)).toHaveLength(3);
  });
  it('FPL har waypoint-tabell og rute', () => {
    const f = routeToFpl('Tur', wps);
    expect(f).toContain('<type>USER WAYPOINT</type>');
    expect(f.match(/<route-point>/g)).toHaveLength(3);
    expect(f).toContain('<country-code>EN</country-code>');
  });
  it('FPL for G1000: unike brukeridenter på maks 6 tegn, NDB-type', () => {
    const f = routeToFpl('Tur til Bergen', [
      { id: 'ENKJ', kind: 'airport', lat: 59.97, lon: 11.04 },
      { id: 'NORDKISA', kind: 'user', lat: 60.18, lon: 11.26 },
      { id: 'NORDKISA 2', kind: 'user', lat: 60.2, lon: 11.3 },
      { id: 'GM', name: 'Gardermoen NDB', kind: 'navaid', lat: 60.2, lon: 11.1 },
      { id: 'ENBR', kind: 'airport', lat: 60.29, lon: 5.22 },
    ]);
    expect(f).toContain('<identifier>NORDKI</identifier>');
    expect(f).toContain('<identifier>NORDK1</identifier>');
    expect(f).toContain('<type>NDB</type>');
    expect(f).toContain('<route-name>TUR TIL BERGEN</route-name>');
    expect(fplFileName([{ id: 'ENKJ', kind: 'airport', lat: 0, lon: 0 }, { id: 'ENBR', kind: 'airport', lat: 0, lon: 0 }])).toBe('ENKJENBR.fpl');
  });
  it('ICAO flightplan', () => {
    const t = icaoFlightPlan({ aircraft: exampleAircraft(), waypoints: wps, eobt: new Date('2026-06-01T10:30:00Z'), eetMin: 95, enduranceMin: 300, altitudeFt: 5500, tas: 105, persons: 2 });
    expect(t).toContain('(FPL-LNXXX-VG');
    expect(t).toContain('-ENKJ1030');
    expect(t).toContain('-N0105A055 DCT 6030N00930E');
    expect(t).toContain('-ENBR0135');
    expect(t).toContain('DOF/260601');
    expect(t).toContain('E/0500 P/002');
  });
});

describe('data', () => {
  it('parser CSV med anførselstegn', () => {
    const rows = parseCsv('a,b,c\n1,"x, ""y""",3\r\n4,5,6\n');
    expect(rows).toEqual([{ a: '1', b: 'x, "y"', c: '3' }, { a: '4', b: '5', c: '6' }]);
  });
  it('bygger database, søker og finner nærmeste', () => {
    const db = buildDb({
      generated: 'x',
      region: 'NO',
      navaids: [],
      airports: [
        ['ENGM', 'Oslo Gardermoen', 'L', 60.19, 11.1, 681, 'NO', 'Oslo', 'OSL', [['01L', '19R', 11811, 148, 'ASP', 1, null, null, null, null, 14]], [['TWR', 'TWR', 118.3]]],
        ['ENKJ', 'Kjeller Airport', 'S', 59.97, 11.04, 354, 'NO', 'Lillestrøm', '', [], []],
        ['ENSG', 'Sogndal Airport, Haukåsen', 'M', 61.15, 7.13, 1633, 'NO', 'Sogndal', 'SOG', [], []],
      ],
    });
    expect(db.byIdent.get('OSL')!.ident).toBe('ENGM');
    expect(db.byIdent.get('ENGM')!.towered).toBe(true);
    expect(db.byIdent.get('ENGM')!.paved).toBe(true);
    expect(searchAirports(db, 'lillestrom')[0].ident).toBe('ENKJ');
    expect(searchAirports(db, 'haukas')[0].ident).toBe('ENSG');
    expect(nearestAirports(db, { lat: 60, lon: 11 }, 1)[0].airport.ident).toBe('ENKJ');
  });
});

import { legAltitudes } from './navlog';
describe('høyde per legg', () => {
  it('bruker legghøyde der den er satt, ellers standard', () => {
    const wps: Waypoint[] = [
      { id: 'A', kind: 'user', lat: 60, lon: 10 },
      { id: 'B', kind: 'user', lat: 60.5, lon: 10.5, legAltFt: 5500 },
      { id: 'C', kind: 'user', lat: 60.5, lon: 9.5 },
    ];
    expect(legAltitudes(wps, 4500)).toEqual([5500, 4500]);
    const legs = computeNavlog(wps, { tas: 100, wind: { dir: 0, speed: 0 }, fuelBurn: 30, altitudeFt: 4500 });
    expect(legs.map((l) => l.altFt)).toEqual([5500, 4500]);
  });
});
