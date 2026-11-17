// Geodesi på kuleflate. Avstander i nautiske mil (NM), vinkler i grader.

export interface LatLon {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_NM = 3440.065;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const norm360 = (d: number): number => ((d % 360) + 360) % 360;
/** Normaliser til (-180, 180]. */
export const norm180 = (d: number): number => {
  const n = norm360(d);
  return n > 180 ? n - 360 : n;
};

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initiell rettvisende kurs fra a til b. */
export function bearingTrue(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return norm360(Math.atan2(y, x) * DEG);
}

/** Punkt som ligger `distNm` unna `p` i retning `brgTrue`. */
export function destination(p: LatLon, brgTrue: number, distNm: number): LatLon {
  const δ = distNm / EARTH_RADIUS_NM;
  const θ = brgTrue * RAD;
  const φ1 = p.lat * RAD;
  const λ1 = p.lon * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * DEG, lon: norm180(λ2 * DEG) };
}

/** Avvik fra storsirkelen a→b (NM, positivt = til høyre for kursen). */
export function crossTrackNm(a: LatLon, b: LatLon, p: LatLon): number {
  const δ13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const θ13 = bearingTrue(a, p) * RAD;
  const θ12 = bearingTrue(a, b) * RAD;
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_NM;
}

/** Midtpunkt på storsirkelen mellom a og b. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  return destination(a, bearingTrue(a, b), distanceNm(a, b) / 2);
}

/**
 * Tolker koordinater skrevet som
 *   5959N01030E, 595930N0103015E (ICAO-format, grader/minutter[/sekunder])
 *   59.98,10.5 eller 59.98 10.5 (desimalgrader)
 *   N59°58.8' E010°30.0' (grader og desimalminutter)
 */
export function parseCoordinate(input: string): LatLon | null {
  const s = input.trim().toUpperCase();

  const icao = s.match(/^(\d{2})(\d{2})(\d{2})?([NS])(\d{3})(\d{2})(\d{2})?([EW])$/);
  if (icao) {
    const lat = +icao[1] + +icao[2] / 60 + (icao[3] ? +icao[3] / 3600 : 0);
    const lon = +icao[5] + +icao[6] / 60 + (icao[7] ? +icao[7] / 3600 : 0);
    return valid({ lat: icao[4] === 'S' ? -lat : lat, lon: icao[8] === 'W' ? -lon : lon });
  }

  const dec = s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (dec) return valid({ lat: +dec[1], lon: +dec[2] });

  const dm = s.match(/^([NS])\s*(\d{1,2})[°\s]\s*(\d{1,2}(?:\.\d+)?)'?\s*([EW])\s*(\d{1,3})[°\s]\s*(\d{1,2}(?:\.\d+)?)'?$/);
  if (dm) {
    const lat = +dm[2] + +dm[3] / 60;
    const lon = +dm[5] + +dm[6] / 60;
    return valid({ lat: dm[1] === 'S' ? -lat : lat, lon: dm[4] === 'W' ? -lon : lon });
  }
  return null;
}

function valid(p: LatLon): LatLon | null {
  return Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? p : null;
}

/** N59°58.80' E010°30.00' */
export function formatLatLon(p: LatLon): string {
  const f = (v: number, pos: string, neg: string, w: number) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = (a - d) * 60;
    if (m >= 59.995) {
      d += 1;
      m = 0;
    }
    return `${v < 0 ? neg : pos}${String(d).padStart(w, '0')}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return `${f(p.lat, 'N', 'S', 2)} ${f(p.lon, 'E', 'W', 3)}`;
}

/** ICAO-format brukt i flightplan felt 15: 5959N01030E */
export function formatIcaoCoord(p: LatLon): string {
  const f = (v: number, pos: string, neg: string, w: number) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.round((a - d) * 60);
    if (m === 60) {
      d += 1;
      m = 0;
    }
    return `${String(d).padStart(w, '0')}${String(m).padStart(2, '0')}${v < 0 ? neg : pos}`;
  };
  return f(p.lat, 'N', 'S', 2) + f(p.lon, 'E', 'W', 3);
}

export const fmtHdg = (d: number): string => String(Math.round(norm360(d)) || 360).padStart(3, '0');
