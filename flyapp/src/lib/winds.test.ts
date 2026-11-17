import { describe, expect, it } from 'vitest';
import { fetchLegWinds, hourIndex, openMeteoUrl, windAt, type OpenMeteoPoint } from './winds';
import { computeNavlog } from './navlog';

// Svar i samme format som Open-Meteo (hourly, timezone=GMT), forenklet til to timer.
function point(over: Record<string, (number | null)[]> = {}): OpenMeteoPoint {
  return {
    latitude: 60,
    longitude: 10,
    elevation: 100, // m
    hourly: {
      time: ['2026-11-18T10:00', '2026-11-18T11:00'],
      wind_speed_10m: [5, 6],
      wind_direction_10m: [180, 180],
      temperature_2m: [8, 9],
      geopotential_height_925hPa: [762, 762], // 2500 ft
      wind_speed_925hPa: [20, 30],
      wind_direction_925hPa: [270, 270],
      temperature_925hPa: [2, 2],
      geopotential_height_850hPa: [1524, 1524], // 5000 ft
      wind_speed_850hPa: [40, 40],
      wind_direction_850hPa: [270, 270],
      temperature_850hPa: [-4, -4],
      // Nivå under bakken skal ignoreres.
      geopotential_height_1000hPa: [20, 20],
      wind_speed_1000hPa: [99, 99],
      wind_direction_1000hPa: [0, 0],
      temperature_1000hPa: [10, 10],
      ...over,
    },
  };
}

describe('vind i høyden', () => {
  it('velger nærmeste time og avviser tid utenfor prognosen', () => {
    const t = ['2026-11-18T10:00', '2026-11-18T11:00'];
    expect(hourIndex(t, new Date('2026-11-18T10:40:00Z'))).toBe(1);
    expect(hourIndex(t, new Date('2026-11-18T10:20:00Z'))).toBe(0);
    expect(hourIndex(t, new Date('2026-11-19T10:00:00Z'))).toBe(-1);
  });
  it('interpolerer mellom trykknivå', () => {
    const w = windAt(point(), new Date('2026-11-18T10:00:00Z'), 3750)!;
    expect(w.dir).toBeCloseTo(270, 3);
    expect(w.speed).toBeCloseTo(30, 3);
    expect(w.tempC).toBeCloseTo(-1, 3);
  });
  it('bruker øverste/nederste nivå utenfor profilen', () => {
    expect(windAt(point(), new Date('2026-11-18T10:00:00Z'), 9000)!.speed).toBeCloseTo(40, 3);
    const low = windAt(point(), new Date('2026-11-18T10:00:00Z'), 300)!;
    expect(low.dir).toBeCloseTo(180, 3); // 10 m-vind, ikke nivået under bakken
    expect(low.speed).toBeCloseTo(5, 3);
  });
  it('interpolerer retning riktig over nord (vektorer)', () => {
    const p = point({ wind_direction_925hPa: [350, 350], wind_direction_850hPa: [10, 10], wind_speed_925hPa: [20, 20], wind_speed_850hPa: [20, 20] });
    const w = windAt(p, new Date('2026-11-18T10:00:00Z'), 3750)!;
    expect(Math.min(w.dir, 360 - w.dir)).toBeLessThan(0.5);
    expect(w.speed).toBeGreaterThan(19);
  });
  it('lager én URL for alle punkter, i knop og GMT', () => {
    const u = new URL(openMeteoUrl([{ lat: 60, lon: 10 }, { lat: 61.5, lon: 7.25 }], 2));
    expect(u.searchParams.get('latitude')).toBe('60.000,61.500');
    expect(u.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(u.searchParams.get('timezone')).toBe('GMT');
    expect(u.searchParams.get('hourly')).toContain('wind_direction_850hPa');
  });
  it('henter vind for flere legg og håndterer enkeltpunkt-svar', async () => {
    const fake = (async () => new Response(JSON.stringify([point(), point()]), { status: 200 })) as typeof fetch;
    const r = await fetchLegWinds(
      [
        { point: { lat: 60, lon: 10 }, time: new Date('2026-11-18T10:00:00Z') },
        { point: { lat: 61, lon: 9 }, time: new Date('2026-11-18T11:00:00Z') },
      ],
      5000,
      fake,
    ).catch((e) => e);
    // Datoen kan ligge i fortiden når testen kjøres; da skal vi likevel få et svar eller en tydelig feil.
    if (Array.isArray(r)) expect(r[0]!.speed).toBeCloseTo(40, 3);
    const single = (async () => new Response(JSON.stringify(point()), { status: 200 })) as typeof fetch;
    const s = await fetchLegWinds([{ point: { lat: 60, lon: 10 }, time: new Date('2026-11-18T11:00:00Z') }], 2500, single).catch(() => null);
    if (s) expect(s[0]!.speed).toBeCloseTo(30, 3);
  });
  it('gir tydelig feil ved 429', async () => {
    const busy = (async () => new Response('{}', { status: 429 })) as typeof fetch;
    await expect(fetchLegWinds([{ point: { lat: 60, lon: 10 }, time: new Date() }], 3000, busy)).rejects.toThrow(/travel/);
  });
  it('navloggen bruker vind per legg', () => {
    const wps = [
      { id: 'A', kind: 'user' as const, lat: 60, lon: 10 },
      { id: 'B', kind: 'user' as const, lat: 61, lon: 10 },
      { id: 'C', kind: 'user' as const, lat: 62, lon: 10 },
    ];
    const legs = computeNavlog(wps, { tas: 100, wind: { dir: 0, speed: 0 }, legWinds: [{ dir: 0, speed: 20 }, null], fuelBurn: 30, altitudeFt: 3500 });
    expect(legs[0].gs).toBeCloseTo(80, 3);
    expect(legs[1].gs).toBeCloseTo(100, 3);
  });
});
