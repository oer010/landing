// Ferdige flyprofiler. Tallene kommer fra flyhåndboken (AFM DA 40 NG, Doc. 6.01.15-E Rev. 3)
// og klubbens masse- og balanseark (MB_BAK_EXCEL 2026.01.02). Sjekk alltid mot gjeldende
// veierapport for flyet før bruk.

import type { Aircraft } from './store';

/** Diamond DA 40 NG med langtrekkstanker, MÄM 40-662 (MTOM 1310 kg) og MÄM 40-574 (MLM 1280 kg). */
function da40ng(id: string, registration: string, emptyWeight: number, emptyArm: number): Aircraft {
  return {
    id,
    fleet: id,
    registration,
    type: 'Diamond DA 40 NG',
    icaoType: 'DA40',
    wake: 'L',
    equipment: 'SDFGY',
    surveillance: 'S',
    colour: 'WHITE',
    // Planlegging som i klubbarket: 75 % effekt, 25 L/t. AFM 5.3.11: 75 % gir 125–127 kt TAS ved 2000–4000 ft ISA.
    tas: 125,
    fuelBurn: 25,
    // AFM 5.3.10: marsjklatring 88 KIAS, 92 % effekt (31,5 L/t), ca. 650 ft/min ved MTOM.
    climbTas: 90,
    climbFpm: 650,
    climbBurn: 31.5,
    // Redusert effekt (ca. 45–50 %), 500 ft/min.
    descentTas: 125,
    descentFpm: 500,
    descentBurn: 16,
    fuelUnit: 'L',
    // Langtrekkstanker: 2 × 73,8 L brukbart (= 118 kg ved 0,80 kg/L).
    usableFuel: 147.6,
    fuelDensity: 0.8,
    weightUnit: 'kg',
    armUnit: 'm',
    emptyWeight,
    emptyArm,
    mtow: 1310,
    mlw: 1280,
    mzfw: 1265,
    minWeight: 940,
    stations: [
      { name: 'Forseter', arm: 2.3, weight: 80 },
      { name: 'Bakseter', arm: 3.25, weight: 0 },
      { name: 'Bagasjerom (standard)', arm: 3.65, weight: 0, max: 45 },
      { name: 'Utvidet bagasje, fremre', arm: 3.89, weight: 0 },
      { name: 'Utvidet bagasje, bakre', arm: 4.54, weight: 0 },
      { name: 'Drivstoff (vingetanker)', arm: 2.63, weight: 118, max: 118, fuel: true },
    ],
    limits: [
      { name: 'Utvidet bagasje (fremre + bakre)', stations: ['Utvidet bagasje, fremre', 'Utvidet bagasje, bakre'], max: 18 },
      { name: 'Bagasje totalt', stations: ['Bagasjerom (standard)', 'Utvidet bagasje, fremre', 'Utvidet bagasje, bakre'], max: 45 },
    ],
    // AFM 2.8: forreste CG 2,40 m fra 940 til 1080 kg, 2,46 m ved 1280 kg, 2,469 m ved 1310 kg; bakerste 2,53 m.
    envelope: [
      { arm: 2.4, weight: 940 },
      { arm: 2.4, weight: 1080 },
      { arm: 2.46, weight: 1280 },
      { arm: 2.469, weight: 1310 },
      { arm: 2.53, weight: 1310 },
      { arm: 2.53, weight: 940 },
    ],
    notes: [
      'Drivstoff: Jet A-1, 0,80 kg/L. Langtrekkstanker 2 × 73,8 L brukbart. Maks forskjell mellom tankene 34 L.',
      'Forbruk (AFM 5.3.2): 60 % 19,5 L/t · 75 % 25 L/t · 92 % 31,5 L/t.',
      'vNE 172 · vNO 130 · vO 101 kt (≤1080 kg), 108 kt (≤1180 kg), 113 kt (over 1180 kg) · vFE LDG 98, T/O 110 KIAS.',
      'Avgang (klaff T/O): vR 56–67 KIAS, v50 62–72 KIAS, vY 72 KIAS. Marsjklatring 88 KIAS (klaff UP).',
      'Innflyging (klaff LDG): 66 KIAS ved 940 kg · 68 ved 1000 kg · 72 ved 1100 kg · 76 ved 1200 kg · 77 ved 1280 kg.',
      'Bagasje: standardrom maks 45 kg, utvidet rom maks 18 kg, til sammen maks 45 kg.',
      'Maks avgangsvekt 1310 kg · maks landingsvekt 1280 kg · maks vekt uten drivstoff 1265 kg · minste flyvekt 940 kg.',
    ],
  };
}

export const FLEET: Aircraft[] = [
  da40ng('ln-ftq', 'LN-FTQ', 928.04, 2.433),
  da40ng('ln-ftu', 'LN-FTU', 926.4, 2.44),
];

export const fleetProfile = (id: string | undefined): Aircraft | undefined => FLEET.find((a) => a.id === id);
