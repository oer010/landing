import { describe, expect, it } from 'vitest';
import { AREAS, latToY, lonToX, tileUrl, tilesAlongRoute, tilesInBox } from './offline';

describe('kart uten nett', () => {
  it('regner flisnummer som Leaflet', () => {
    expect(lonToX(10.75, 7)).toBe(67);
    expect(latToY(59.9, 7)).toBe(37);
    expect(tileUrl({ z: 7, x: 67, y: 37 })).toBe('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/7/37/67.png');
  });
  it('har rimelig antall fliser for områdene', () => {
    const n = tilesInBox(AREAS.sor.box, 5, AREAS.sor.zMax).length;
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(6000);
  });
  it('korridor langs ruten uten duplikater', () => {
    const t = tilesAlongRoute([{ lat: 59.97, lon: 11.04 }, { lat: 60.39, lon: 5.22 }], 10, 7, 11);
    expect(new Set(t.map((x) => `${x.z}/${x.x}/${x.y}`)).size).toBe(t.length);
    expect(t.length).toBeGreaterThan(50);
  });
});
