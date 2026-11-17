// Soloppgang/-nedgang og sivil skumring (for VFR natt-grensen).
// Algoritme etter NOAA/SunCalc (V. Agafonkin, BSD-lisens), nøyaktighet ~1 min.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const J0 = 0.0009;

const toJulian = (d: Date) => d.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (d: Date) => toJulian(d) - J2000;
const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const julianCycle = (d: number, lw: number) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, d: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  solarNoon: Date;
  /** 'normal' | 'midnattssol' (sola går aldri ned) | 'mørketid' (sola står aldri opp) */
  polar: 'normal' | 'midnight-sun' | 'polar-night';
  /** Som over, men for sivil skumring (-6°). */
  civilPolar: 'normal' | 'always-light' | 'always-dark';
}

export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  // Bruk middag UTC for datoen for å få riktig syklus.
  const d0 = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(d0);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const pair = (hDeg: number): [Date | null, Date | null, number] => {
    const cosH = (Math.sin(hDeg * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosH < -1) return [null, null, 1]; // alltid over
    if (cosH > 1) return [null, null, -1]; // alltid under
    const w = hourAngle(hDeg * RAD, phi, dec);
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    return [fromJulian(Jrise), fromJulian(Jset), 0];
  };

  const [sunrise, sunset, sp] = pair(-0.833);
  const [civilDawn, civilDusk, cp] = pair(-6);
  return {
    sunrise,
    sunset,
    civilDawn,
    civilDusk,
    solarNoon: fromJulian(Jnoon),
    polar: sp === 1 ? 'midnight-sun' : sp === -1 ? 'polar-night' : 'normal',
    civilPolar: cp === 1 ? 'always-light' : cp === -1 ? 'always-dark' : 'normal',
  };
}

/** Er tidspunktet "natt" i VFR-forstand (mellom slutt og start på sivil skumring)? */
export function isNight(t: Date, lat: number, lon: number): boolean {
  const s = sunTimes(t, lat, lon);
  if (s.civilPolar === 'always-light') return false;
  if (s.civilPolar === 'always-dark') return true;
  return t < (s.civilDawn as Date) || t > (s.civilDusk as Date);
}
