import { describe, expect, it } from 'vitest';
import { obstaclesAhead, topFt, type Obstacle } from './obstacles';

const mast: Obstacle = { lat: 60.01, lon: 11.0, heightM: 150, groundM: 200, type: 'M', lit: true };

describe('hindre', () => {
  it('topp over havet', () => expect(topFt(mast)).toBe(1148));
  it('varsler bare når hinderet er foran og flyet er for lavt', () => {
    const pos = { lat: 60.0, lon: 11.0 };
    expect(obstaclesAhead([mast], pos, 0, 100, 1400)).toHaveLength(1);
    expect(obstaclesAhead([mast], pos, 0, 100, 2000)).toHaveLength(0);
    expect(obstaclesAhead([mast], pos, 180, 100, 1400)).toHaveLength(0);
    expect(obstaclesAhead([mast], pos, 90, 100, 1400)).toHaveLength(0);
  });
  it('ukjent terreng: konservativt', () => {
    const m = { ...mast, groundM: null };
    expect(obstaclesAhead([m], { lat: 60.0, lon: 11.0 }, 0, 100, 1500)).toHaveLength(1);
    expect(obstaclesAhead([m], { lat: 60.0, lon: 11.0 }, 0, 100, 3000)).toHaveLength(0);
  });
});
