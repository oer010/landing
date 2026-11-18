import { describe, expect, it } from 'vitest';
import { routeTerrain } from './terrain';

describe('terreng', () => {
  it('tar høyeste punkt i korridoren og samler i bunker på 50', async () => {
    let calls = 0;
    const fake = (async (url: string) => {
      calls++;
      const pts = JSON.parse(decodeURIComponent(url.split('punkter=')[1])) as [number, number][];
      expect(pts.length).toBeLessThanOrEqual(50);
      // Et «fjell» øst for linjen.
      return new Response(JSON.stringify({ punkter: pts.map(([x]) => ({ z: x > 10.51 ? 1000 : 100 })) }));
    }) as typeof fetch;
    const s = await routeTerrain([{ lat: 60, lon: 10.5 }, { lat: 60.5, lon: 10.5 }], 0.5, 1, fake);
    expect(s.length).toBeGreaterThan(50);
    expect(s[0].ft).toBeCloseTo(3280.8, 0);
    expect(s[s.length - 1].d).toBeCloseTo(30, 0);
    expect(calls).toBeGreaterThan(1);
  });
});
