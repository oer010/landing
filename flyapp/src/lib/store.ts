// Enkel lokal lagring. Alt ligger i nettleseren (localStorage) – ingen konto, ingen sky.

import type { Waypoint } from './navlog';
import type { EnvelopePoint, Station } from './wb';

export interface Aircraft {
  id: string;
  registration: string;
  type: string;
  /** ICAO-typebetegnelse og utstyr for flightplan. */
  icaoType: string;
  wake: 'L' | 'M' | 'H';
  equipment: string;
  surveillance: string;
  colour: string;
  tas: number;
  fuelBurn: number;
  /** Klatring: TAS (kt), stigehastighet (ft/min), forbruk (per time). Valgfrie i eldre profiler. */
  climbTas?: number;
  climbFpm?: number;
  climbBurn?: number;
  /** Nedstigning: TAS (kt), synkehastighet (ft/min), forbruk (per time). */
  descentTas?: number;
  descentFpm?: number;
  descentBurn?: number;
  fuelUnit: 'L' | 'USG';
  usableFuel: number;
  /** Vekt per drivstoffenhet i vektenheten (kg/L ≈ 0,72 for avgas). */
  fuelDensity: number;
  weightUnit: 'kg' | 'lb';
  armUnit: 'm' | 'in';
  emptyWeight: number;
  emptyArm: number;
  mtow: number;
  /** Maks landingsvekt, maks vekt uten drivstoff og minste flyvekt (valgfrie). */
  mlw?: number;
  mzfw?: number;
  minWeight?: number;
  stations: Station[];
  /** Felles grenser for flere stasjoner (f.eks. bagasjerom til sammen). */
  limits?: { name: string; stations: string[]; max: number }[];
  /** Nøkkeltall fra flyhåndboken. */
  notes?: string[];
  /** Id til innebygd profil (kan tilbakestilles til den). */
  fleet?: string;
  envelope: EnvelopePoint[];
}

export interface SavedRoute {
  id: string;
  name: string;
  waypoints: Waypoint[];
  altitudeFt: number;
  windDir: number;
  windSpeed: number;
  aircraftId: string;
  departureTime?: string;
  fuelOnBoard?: number;
  updated: string;
}

export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  altM: number | null;
  gsKt: number | null;
}

export interface Track {
  id: string;
  name: string;
  started: number;
  points: TrackPoint[];
}

export interface LogEntry {
  id: string;
  date: string;
  aircraft: string;
  from: string;
  to: string;
  blockMin: number;
  landings: number;
  night: boolean;
  remarks: string;
}

export interface Checklist {
  id: string;
  name: string;
  items: { text: string; done: boolean }[];
}

export interface Settings {
  baseLayer: 'osm' | 'topo';
  showAirports: boolean;
  showNavaids: boolean;
  showMetars: boolean;
  showAirspace: boolean;
  showVfrPoints: boolean;
  showVfrCharts: boolean;
  showNotams: boolean;
  vectorMin: number;
  disclaimerAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  baseLayer: 'topo',
  showAirports: true,
  showNavaids: true,
  showMetars: true,
  showAirspace: true,
  showVfrPoints: true,
  showVfrCharts: true,
  showNotams: true,
  vectorMin: 5,
  disclaimerAccepted: false,
};

const PREFIX = 'vfrapp.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('Kunne ikke lagre', key, e);
  }
}

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * Eksempelprofil. Tallene er bare illustrasjon i stil med et firesetes
 * enmotors skolefly – bruk alltid verdier fra ditt eget flys veie- og balanserapport/POH.
 */
export function exampleAircraft(): Aircraft {
  return {
    id: 'example',
    registration: 'LN-XXX',
    type: 'Eksempel 4-seter (bytt tall!)',
    icaoType: 'C172',
    wake: 'L',
    equipment: 'SDFGY',
    surveillance: 'S',
    colour: 'WHITE BLUE',
    tas: 105,
    fuelBurn: 32,
    climbTas: 75,
    climbFpm: 650,
    climbBurn: 40,
    descentTas: 110,
    descentFpm: 500,
    descentBurn: 25,
    fuelUnit: 'L',
    usableFuel: 200,
    fuelDensity: 0.72,
    weightUnit: 'kg',
    armUnit: 'm',
    emptyWeight: 750,
    emptyArm: 1.0,
    mtow: 1110,
    stations: [
      { name: 'Fører + forsete', arm: 0.94, weight: 160 },
      { name: 'Baksete', arm: 1.85, weight: 0 },
      { name: 'Bagasje 1', arm: 2.41, weight: 10, max: 54 },
      { name: 'Drivstoff', arm: 1.22, weight: 108, fuel: true },
    ],
    envelope: [
      { arm: 0.89, weight: 680 },
      { arm: 0.89, weight: 885 },
      { arm: 1.0, weight: 1110 },
      { arm: 1.2, weight: 1110 },
      { arm: 1.2, weight: 680 },
    ],
  };
}

export function defaultChecklists(): Checklist[] {
  const mk = (name: string, items: string[]): Checklist => ({
    id: uid(),
    name,
    items: items.map((text) => ({ text, done: false })),
  });
  return [
    mk('Før flyging (planlegging)', [
      'Pilot: sertifikat, medisinsk, nylig erfaring (3 landinger/90 dager)',
      'IMSAFE: sykdom, medisiner, stress, alkohol, tretthet, mat',
      'Vær: METAR/TAF, GAMET/LLF, vind i høyden, frysepunkt',
      'NOTAM for avgang, destinasjon, alternativ og ruten',
      'Luftrom: kontrollert/restriksjoner, frekvenser, rapporteringspunkter',
      'Rute og navlogg ferdig, marsjhøyde iht. halvsirkelregelen',
      'Drivstoff: tur + reserve (30 min dag / 45 min natt) + margin',
      'Masse og balanse innenfor grensene ved avgang og landing',
      'Ytelse: start- og landingsdistanse mot tilgjengelig bane',
      'Solnedgang/sivil skumring mot ETA',
      'Flightplan levert / åpnet ved behov',
      'Dokumenter om bord: CofR, CofA/ARC, forsikring, radiolisens, POH',
    ]),
    mk('Underveis (FREDA)', [
      'Fuel – mengde og tankvalg',
      'Radio – riktig frekvens, transponder',
      'Engine – temperaturer og trykk',
      'Direction – kurs og retningsviser mot kompass',
      'Altitude – høyde og QNH',
    ]),
    mk('Før landing', [
      'ATIS/AFIS/vind og bane i bruk',
      'QNH satt',
      'Landingssjekk etter flyets sjekkliste',
      'Trafikkrunde og innflyging planlagt',
    ]),
  ];
}

/** Ytelse for klatring/nedstigning, med fornuftige standardverdier for eldre profiler. */
export function perfOf(ac: Aircraft) {
  return {
    climbTas: ac.climbTas ?? Math.round(ac.tas * 0.72),
    climbFpm: ac.climbFpm ?? 600,
    climbBurn: ac.climbBurn ?? Math.round(ac.fuelBurn * 1.25),
    descentTas: ac.descentTas ?? Math.round(ac.tas * 1.05),
    descentFpm: ac.descentFpm ?? 500,
    descentBurn: ac.descentBurn ?? Math.round(ac.fuelBurn * 0.75),
    cruiseTas: ac.tas,
    cruiseBurn: ac.fuelBurn,
  };
}
