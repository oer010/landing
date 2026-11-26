// Er AIP-dataene i appen gjeldende? Avinor tillater ikke at nettleseren leser AIP-sidene
// direkte (CORS), så AIP-jobben på GitHub sjekker utgaven og legger status på datagrenen.
// Appen henter statusen ved oppstart og avgjør om kartlenkene kan åpnes direkte.

export const AIP_ROOT = 'https://aim-prod.avinor.no/no/AIP';
const STATUS_URL = 'https://raw.githubusercontent.com/oer010/landing/notam-data/aip-status.json';

/** En kjent AIRAC-dato; syklusen er 28 dager. */
const AIRAC_REF = Date.UTC(2026, 10, 26);
const CYCLE = 28 * 864e5;

/** Siste AIRAC-dato som har trådt i kraft (00:00 UTC). */
export function latestAirac(now = new Date()): Date {
  return new Date(AIRAC_REF + Math.floor((now.getTime() - AIRAC_REF) / CYCLE) * CYCLE);
}

export interface AipStatus {
  /** Gjeldende utgave hos Avinor da jobben sist sjekket. */
  current: string;
  checkedAt: string;
}

export type ChartMode = 'direct' | 'avinor';

/**
 * Kan kartlenkene (som peker til en bestemt utgave) brukes direkte?
 * Ja når statusen bekrefter at utgaven er gjeldende og sjekken er gjort etter siste AIRAC-dato.
 * Ellers kan Avinor ha publisert en ny utgave – da åpnes AIP-forsiden i stedet for en død lenke.
 */
export function chartMode(dataEdition: string | undefined, status: AipStatus | null, now = new Date()): ChartMode {
  if (!dataEdition) return 'avinor';
  const airac = latestAirac(now).getTime();
  if (status) {
    if (status.current !== dataEdition) return 'avinor';
    if (new Date(status.checkedAt).getTime() >= airac) return 'direct';
  }
  // Ingen fersk status: stol på dataene bare hvis ingen ny AIRAC-dato har passert siden utgaven.
  return new Date(`${dataEdition}T00:00:00Z`).getTime() >= airac ? 'direct' : 'avinor';
}

let p: Promise<AipStatus | null> | null = null;
export function loadAipStatus(): Promise<AipStatus | null> {
  p ??= fetch(`${STATUS_URL}?t=${Math.floor(Date.now() / 600e3)}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<AipStatus>) : null))
    .catch(() => null);
  return p;
}
