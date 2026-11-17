// Elektronisk E6B: høyder, hastigheter og omregninger.

/** Trykkhøyde (ft) fra feltets høyde og QNH (hPa), ISA-formel. */
export function pressureAltitude(elevationFt: number, qnhHpa: number): number {
  return elevationFt + 145366.45 * (1 - Math.pow(qnhHpa / 1013.25, 0.190284));
}

export const isaTempC = (pressureAltFt: number): number => 15 - 1.98 * (pressureAltFt / 1000);

/** Tetthetshøyde (ft), standard tommelfingerregel 118,8 ft per °C avvik fra ISA. */
export function densityAltitude(pressureAltFt: number, oatC: number): number {
  return pressureAltFt + 118.8 * (oatC - isaTempC(pressureAltFt));
}

/** TAS fra CAS (≈IAS) ved gitt trykkhøyde og temperatur (inkompressibel tilnærming). */
export function trueAirspeed(cas: number, pressureAltFt: number, oatC: number): number {
  const pRatio = Math.pow(1 - 6.8755856e-6 * pressureAltFt, 5.25588);
  const tRatio = (oatC + 273.15) / 288.15;
  const sigma = pRatio / tRatio;
  return cas / Math.sqrt(sigma);
}

export const conv = {
  ftToM: (ft: number) => ft * 0.3048,
  mToFt: (m: number) => m / 0.3048,
  nmToKm: (nm: number) => nm * 1.852,
  kmToNm: (km: number) => km / 1.852,
  smToKm: (sm: number) => sm * 1.609344,
  ktToKmh: (kt: number) => kt * 1.852,
  ktToMs: (kt: number) => kt * 0.514444,
  msToKt: (ms: number) => ms / 0.514444,
  cToF: (c: number) => (c * 9) / 5 + 32,
  fToC: (f: number) => ((f - 32) * 5) / 9,
  hpaToInHg: (h: number) => h / 33.8639,
  inHgToHpa: (i: number) => i * 33.8639,
  lToUsg: (l: number) => l / 3.785411784,
  usgToL: (g: number) => g * 3.785411784,
  kgToLb: (kg: number) => kg / 0.45359237,
  lbToKg: (lb: number) => lb * 0.45359237,
  /** Avgass (100LL) ≈ 0,72 kg/L. */
  avgasLToKg: (l: number) => l * 0.72,
};

/** Tid, distanse, fart: gi to av dem, få den tredje. */
export function timeSpeedDistance(o: { speedKt?: number; distNm?: number; timeMin?: number }) {
  const { speedKt, distNm, timeMin } = o;
  if (speedKt && distNm && !timeMin) return { speedKt, distNm, timeMin: (distNm / speedKt) * 60 };
  if (speedKt && timeMin && !distNm) return { speedKt, timeMin, distNm: (speedKt * timeMin) / 60 };
  if (distNm && timeMin && !speedKt) return { distNm, timeMin, speedKt: distNm / (timeMin / 60) };
  return null;
}

/** Duggpunkt-spredning → omtrentlig skybase (ft AGL). */
export const cloudBaseFt = (tempC: number, dewC: number): number => ((tempC - dewC) / 2.5) * 1000;
