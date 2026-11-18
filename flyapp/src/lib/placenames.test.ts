import { describe, expect, it } from 'vitest';
import { nearestPlaceName, pickPlaceName } from './placenames';

const hit = (navn: string, type: string, m: number) => ({ navneobjekttype: type, meterFraPunkt: m, stedsnavn: [{ skrivemåte: navn }] });

describe('stedsnavn', () => {
  it('foretrekker synlige steder, men nær foran langt unna', () => {
    expect(pickPlaceName([hit('Osterøyvegen', 'Adressenavn', 50), hit('Havrå', 'Bruk', 300), hit('Varde', 'Høyde', 1000), hit('Osterfjorden', 'Fjord', 2000)])!.name).toBe('Osterfjorden');
    expect(pickPlaceName([hit('Stranda', 'Tettsted', 2600), hit('Storelva', 'Elv', 600)])!.name).toBe('Stranda');
    expect(pickPlaceName([hit('Litjhaugen', 'Haug', 100), hit('Nordfjord', 'Fjord', 9000)])!.name).toBe('Litjhaugen');
    expect(pickPlaceName([hit('X-veien', 'Adressenavn', 10)])).toBeNull();
  });
  it('henter fra Kartverket og cacher', async () => {
    let calls = 0;
    const f = (async (url: string) => {
      calls++;
      expect(url).toContain('ws.geonorge.no/stedsnavn/v1/punkt');
      return new Response(JSON.stringify({ navn: [hit('Herdlefjorden', 'Fjord', 800)] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = { lat: 60.55, lon: 5.0 };
    expect((await nearestPlaceName(p, f))!.name).toBe('Herdlefjorden');
    await nearestPlaceName(p, f);
    expect(calls).toBe(1);
  });
});
