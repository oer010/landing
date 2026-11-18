// Start- og landingsdistanse for Diamond DA 40 NG fra AFM (Doc. 6.01.15-E Rev. 3),
// kapittel 5.3.7 (start, klaff T/O) og 5.3.12 (landing, klaff LDG). Tabellene er lest
// direkte fra flyhåndboken. Interpolasjon i masse, trykkhøyde og temperatur.

type Table = { gr: number[][]; d50: number[][] };

/** Rader: trykkhøyde 0, 1000 … 10000 ft. Kolonner: 0, 10, 20 … 50 °C (mangler der AFM ikke har verdi). */
const TO: Record<number, Table> = {
  1100: { gr: [[280, 295, 310, 330, 355, 380], [295, 315, 335, 355, 385, 410], [315, 335, 355, 385, 415, 445], [340, 360, 385, 415, 450, 480], [360, 385, 415, 455, 490, 525], [385, 415, 455, 495, 530], [415, 455, 495, 545, 580], [450, 495, 545, 600, 640], [490, 545, 605, 660, 705], [540, 600, 665, 725, 780], [600, 665, 715, 785]], d50: [[430, 450, 470, 490, 530, 560], [450, 470, 500, 530, 570, 600], [480, 500, 530, 570, 600, 650], [500, 530, 560, 610, 650, 690], [530, 560, 600, 650, 700, 750], [560, 600, 650, 710, 750], [600, 650, 700, 770, 820], [640, 700, 770, 830, 890], [690, 760, 840, 910, 970], [760, 830, 910, 980, 1050], [830, 910, 970, 1060]] },
  1200: { gr: [[325, 345, 365, 385, 410, 440], [345, 365, 390, 415, 445, 475], [365, 390, 415, 445, 480, 515], [390, 415, 445, 485, 520, 560], [420, 445, 480, 525, 565, 610], [450, 480, 525, 575, 615], [480, 525, 575, 630, 670], [520, 570, 630, 690, 735], [570, 630, 695, 760, 810], [625, 695, 765, 830, 895], [690, 765, 825, 900]], d50: [[490, 520, 540, 570, 610, 640], [520, 550, 570, 610, 650, 690], [550, 580, 610, 650, 700, 740], [580, 610, 650, 700, 750, 800], [610, 640, 700, 750, 800, 860], [650, 690, 750, 810, 870], [690, 740, 810, 880, 940], [740, 800, 880, 960, 1010], [800, 870, 960, 1040, 1110], [870, 950, 1050, 1120, 1200], [950, 1040, 1110, 1210]] },
  1280: { gr: [[365, 385, 405, 425, 460, 490], [385, 410, 430, 460, 495, 530], [410, 435, 460, 495, 535, 570], [435, 465, 495, 535, 580, 620], [470, 495, 535, 585, 625, 675], [500, 535, 580, 635, 680], [535, 580, 635, 695, 740], [575, 635, 695, 760, 810], [630, 695, 765, 840, 895], [690, 765, 845, 910, 980], [765, 845, 905, 985]], d50: [[540, 570, 600, 630, 670, 710], [580, 600, 630, 670, 720, 760], [610, 640, 670, 720, 770, 820], [640, 670, 710, 770, 820, 880], [680, 720, 770, 830, 890, 950], [720, 760, 830, 890, 950], [760, 820, 890, 970, 1030], [810, 890, 970, 1050, 1120], [880, 960, 1050, 1150, 1220], [960, 1050, 1150, 1230, 1320], [1040, 1140, 1230, 1330]] },
  1310: { gr: [[365, 385, 410, 430, 460, 495], [390, 410, 435, 465, 500, 535], [415, 440, 465, 500, 540, 575], [440, 470, 500, 540, 580, 625], [470, 500, 540, 590, 630, 680], [505, 535, 585, 640, 685], [540, 585, 640, 700, 750], [580, 640, 700, 765, 820], [635, 700, 770, 845, 900], [695, 770, 850, 915, 990], [765, 850, 910, 995]], d50: [[550, 580, 610, 640, 680, 720], [580, 610, 640, 680, 730, 770], [610, 640, 680, 730, 780, 830], [650, 680, 720, 780, 840, 890], [690, 720, 780, 840, 900, 960], [730, 770, 840, 910, 970], [770, 830, 900, 980, 1040], [820, 900, 980, 1060, 1130], [890, 970, 1060, 1160, 1230], [970, 1060, 1160, 1250, 1330], [1050, 1160, 1240, 1340]] },
};
const LDG: Record<number, Table> = {
  1100: { gr: [[255, 265, 275, 285, 300, 320], [265, 275, 285, 295, 315, 335], [275, 285, 295, 310, 330, 350], [285, 295, 310, 330, 345, 370], [295, 305, 325, 345, 365, 385], [305, 320, 340, 360, 385], [320, 335, 355, 380, 405], [345, 365, 390, 415, 440], [400, 425, 450, 480, 510], [465, 495, 525, 560, 590], [535, 565, 600, 635]], d50: [[590, 610, 630, 640, 680, 720], [590, 610, 630, 660, 690, 730], [600, 620, 640, 670, 710, 750], [610, 630, 650, 690, 730, 770], [620, 640, 670, 710, 750, 800], [630, 650, 690, 730, 780], [640, 680, 720, 760, 800], [670, 710, 750, 800, 840], [740, 790, 840, 880, 930], [830, 880, 930, 980, 1030], [910, 960, 1010, 1070]] },
  1200: { gr: [[280, 290, 300, 310, 325, 345], [290, 300, 310, 320, 340, 360], [300, 310, 320, 340, 360, 380], [310, 320, 335, 355, 375, 400], [320, 335, 350, 375, 395, 420], [335, 345, 370, 395, 415], [345, 365, 390, 415, 435], [370, 400, 425, 450, 475], [425, 455, 485, 515, 545], [490, 525, 555, 590, 620], [560, 590, 630, 665]], d50: [[600, 620, 640, 660, 690, 730], [610, 630, 650, 680, 720, 760], [620, 640, 660, 700, 740, 780], [630, 650, 680, 720, 760, 800], [650, 670, 700, 740, 790, 830], [660, 690, 730, 770, 810], [680, 710, 750, 800, 840], [710, 750, 790, 840, 890], [780, 820, 870, 920, 980], [860, 910, 960, 1020, 1070], [930, 990, 1050, 1100]] },
  1280: { gr: [[295, 305, 320, 330, 345, 365], [305, 320, 330, 340, 365, 385], [320, 330, 340, 360, 380, 405], [330, 340, 355, 375, 400, 425], [340, 355, 375, 395, 420, 445], [355, 370, 390, 415, 440], [365, 385, 415, 440, 465], [395, 420, 450, 475, 505], [450, 480, 510, 540, 570], [510, 545, 580, 615, 650], [575, 610, 650, 685]], d50: [[610, 630, 650, 670, 710, 750], [630, 650, 670, 690, 730, 770], [640, 660, 680, 720, 750, 800], [650, 670, 700, 740, 780, 830], [670, 690, 720, 770, 810, 860], [680, 710, 750, 800, 840], [700, 740, 780, 830, 870], [730, 780, 820, 870, 920], [800, 850, 900, 950, 1010], [880, 930, 990, 1040, 1100], [960, 1010, 1070, 1130]] },
  1310: { gr: [[305, 315, 325, 335, 355, 375], [315, 325, 335, 350, 370, 395], [325, 335, 350, 370, 390, 415], [335, 350, 365, 385, 410, 435], [350, 360, 380, 405, 430, 455], [360, 375, 400, 425, 450], [375, 395, 420, 445, 475], [400, 430, 460, 485, 515], [455, 485, 520, 550, 585], [520, 555, 585, 625, 660], [580, 620, 655, 695]], d50: [[620, 650, 670, 680, 720, 760], [640, 660, 680, 700, 740, 790], [650, 670, 690, 730, 770, 810], [670, 690, 710, 750, 800, 840], [680, 700, 740, 780, 830, 870], [700, 720, 770, 810, 860], [710, 750, 790, 840, 890], [750, 790, 840, 890, 940], [810, 870, 920, 970, 1020], [890, 950, 1000, 1060, 1120], [970, 1030, 1090, 1140]] },
};

export interface PerfInput {
  massKg: number;
  pressureAltFt: number;
  oatC: number;
  /** Motvind (+) / medvind (−) langs banen, kt. */
  headwindKt: number;
  surface: 'paved' | 'grass-short' | 'grass-medium' | 'grass-long';
  wet: boolean;
  /** Helning i % (+ = oppover i kjøreretningen). */
  slopePct: number;
}

export interface PerfResult {
  groundRollM: number;
  over50ftM: number;
  /** Rå tabellverdier før korreksjoner. */
  tableGroundRollM: number;
  tableOver50ftM: number;
  notes: string[];
  outsideTable: boolean;
}

function interp1(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Verdi i én tabell for trykkhøyde og temperatur (bilineær). null utenfor tabellen. */
function lookup(rows: number[][], pa: number, oat: number): number | null {
  const p = Math.max(0, pa) / 1000;
  const t = Math.max(0, oat) / 10;
  const i0 = Math.floor(p);
  const i1 = Math.min(10, i0 + 1);
  const j0 = Math.floor(t);
  const j1 = j0 + 1;
  if (i0 > 10) return null;
  const v = (i: number, j: number) => rows[i]?.[j];
  const corner = [v(i0, j0), v(i0, Math.min(j1, 5)), v(i1, j0), v(i1, Math.min(j1, 5))];
  if (corner.some((c) => c === undefined)) return null;
  const fx = t - j0;
  const a = interp1(fx, 0, 1, corner[0]!, j1 > 5 ? corner[0]! : corner[1]!);
  const b = interp1(fx, 0, 1, corner[2]!, j1 > 5 ? corner[2]! : corner[3]!);
  return interp1(p - i0, 0, 1, a, b);
}

function base(tables: Record<number, Table>, inp: PerfInput): { gr: number; d50: number } | null {
  const ws = Object.keys(tables).map(Number).sort((a, b) => a - b);
  // Lettere enn laveste tabell: bruk laveste (konservativt).
  const m = Math.max(ws[0], Math.min(ws[ws.length - 1], inp.massKg));
  let k = ws.findIndex((w) => w >= m);
  if (k <= 0) k = 1;
  const [w0, w1] = [ws[k - 1], ws[k]];
  const g0 = lookup(tables[w0].gr, inp.pressureAltFt, inp.oatC);
  const g1 = lookup(tables[w1].gr, inp.pressureAltFt, inp.oatC);
  const d0 = lookup(tables[w0].d50, inp.pressureAltFt, inp.oatC);
  const d1 = lookup(tables[w1].d50, inp.pressureAltFt, inp.oatC);
  if (g0 === null || g1 === null || d0 === null || d1 === null) return null;
  return { gr: interp1(m, w0, w1, g0, g1), d50: interp1(m, w0, w1, d0, d1) };
}

function result(b: { gr: number; d50: number } | null, inp: PerfInput, kind: 'to' | 'ldg'): PerfResult {
  const notes: string[] = [];
  if (!b) return { groundRollM: NaN, over50ftM: NaN, tableGroundRollM: NaN, tableOver50ftM: NaN, notes: ['Utenfor tabellene i AFM (for høy trykkhøyde/temperatur).'], outsideTable: true };
  let gr = b.gr;
  let d50 = b.d50;
  const addGr = (factor: number, why: string) => {
    const extra = gr * factor;
    gr += extra;
    d50 += extra;
    notes.push(why);
  };
  // Vind (AFM: faktorene har allerede 50 % motvind / 150 % medvind innebygd).
  const hw = inp.headwindKt;
  const f = hw >= 0 ? -0.1 * (hw / (kind === 'to' ? 12 : 20)) : 0.1 * (-hw / (kind === 'to' ? 2 : 3));
  if (hw !== 0) {
    gr *= 1 + f;
    d50 *= 1 + f;
    notes.push(`${hw > 0 ? 'Motvind' : 'Medvind'} ${Math.abs(Math.round(hw))} kt: ${f > 0 ? '+' : ''}${Math.round(f * 100)} %`);
  }
  if (kind === 'to') {
    if (inp.surface === 'grass-short') addGr(0.1, 'Gress ≤5 cm: +10 % rulledistanse');
    if (inp.surface === 'grass-medium') addGr(0.3, 'Gress 5–10 cm: +30 % rulledistanse');
    if (inp.surface === 'grass-long') addGr(0.45, 'Gress ~25 cm: +45 % rulledistanse');
    if (inp.wet && inp.surface !== 'paved') addGr(0.2, 'Vått gress: +20 %');
    if (inp.slopePct > 0) addGr(0.15 * inp.slopePct, `Oppoverbakke ${inp.slopePct} %: +${Math.round(15 * inp.slopePct)} % rulledistanse`);
  } else {
    if (inp.surface !== 'paved') addGr(inp.surface === 'grass-short' ? 0.3 : 0.45, `Gress: +${inp.surface === 'grass-short' ? 30 : 45} % rulledistanse`);
    if (inp.wet) {
      if (inp.surface === 'paved') {
        gr *= 1.15;
        d50 *= 1.15;
        notes.push('Våt asfalt: +15 %');
      } else addGr(0.15, 'Vått/mykt gress: +15 % rulledistanse');
    }
    if (inp.slopePct < 0) addGr(0.1 * -inp.slopePct, `Nedoverbakke ${-inp.slopePct} %: +${Math.round(10 * -inp.slopePct)} % rulledistanse`);
  }
  if (inp.oatC < 0) notes.push('Under 0 °C: verdiene for 0 °C er brukt (konservativt).');
  if (inp.massKg < 1100) notes.push('Under 1100 kg: verdiene for 1100 kg er brukt (konservativt).');
  return { groundRollM: Math.round(gr), over50ftM: Math.round(d50), tableGroundRollM: Math.round(b.gr), tableOver50ftM: Math.round(b.d50), notes, outsideTable: false };
}

export const takeoffDistance = (inp: PerfInput): PerfResult => result(base(TO, inp), inp, 'to');
export const landingDistance = (inp: PerfInput): PerfResult => result(base(LDG, inp), inp, 'ldg');

/** Trykkhøyde fra flyplasshøyde og QNH. */
export const pressureAltitude = (elevFt: number, qnh: number) => Math.round(elevFt + (1013.25 - qnh) * 27);
