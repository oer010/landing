// Leser VFR-rapporteringspunkt-symbolene på et AIP-kart:
//  - fylt trekant (▲) = obligatorisk rapporteringspunkt, åpen (△) = på forespørsel
//  - kobler symbol ↔ navn ↔ koordinattabell
//  - georefererer kartet fra tabellpunktene og regner ut posisjon for symboler
//    som har navn på kartet men ikke står i tabellen.
// Krever poppler (pdftotext, pdftocairo).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseChartPoints } from './vfr.mjs';
import { fitAffine } from './vfrcharts.mjs';

const run = promisify(execFile);
const BIG = { maxBuffer: 256 * 1024 * 1024 };
const BLACK = 'rgb(0%, 0%, 0%)';

export function parseWords(bboxHtml) {
  return [...bboxHtml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
    x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], w: m[5].replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  }));
}

/** Trekant-symboler (6–12 pt) med fylt/åpen, slått sammen når fyll og kant er egne stier. */
export function findSymbols(svg) {
  const body = svg.slice(svg.indexOf('</defs>') + 1);
  const raw = [];
  for (const p of body.match(/<path[^>]*\/>/g) ?? []) {
    const stroke = p.match(/stroke="([^"]+)"/)?.[1] ?? null;
    const fill = p.match(/fill="([^"]+)"/)?.[1] ?? null;
    if (stroke !== BLACK && fill !== BLACK) continue;
    const d = p.match(/ d="([^"]+)"/)?.[1];
    if (!d) continue;
    const tm = p.match(/transform="matrix\(([^)]*)\)"/);
    const [a, b, c, dd, e, f] = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    for (const sub of d.split(/(?=M)/)) {
      if (!/Z/.test(sub) || /C/.test(sub)) continue;
      const nums = [...sub.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);
      if (nums.length < 6 || nums.length > 10) continue;
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([a * nums[i] + c * nums[i + 1] + e, b * nums[i] + dd * nums[i + 1] + f]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      // Rapporteringspunkt-trekanten er ca. 8–10 pt bred; VOR/DME-symboler (11 × 8,4) er utelatt.
      if (w < 7 || w > 10.5 || h < 6 || h > 9.5) continue;
      // Spissen opp: ett hjørne høyest (minste y), to nederst.
      raw.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, filled: fill === BLACK });
    }
  }
  const out = [];
  for (const s of raw) {
    const same = out.find((o) => Math.hypot(o.x - s.x, o.y - s.y) < 2);
    if (same) same.filled ||= s.filled;
    else out.push({ ...s });
  }
  return out;
}

/** Ord på samme linje som står tett → etikett-grupper («BJØRNØY LIGHT»). */
function labelGroups(words) {
  // Minst to bokstaver per ord (enkeltbokstaver er f.eks. VOR-identen «T R O» i navaid-boksen).
  const cand = words.filter((w) => /^[A-ZÆØÅ][A-ZÆØÅ\-.]*$/.test(w.w) && w.w.length >= 2);
  const groups = [];
  for (const w of cand.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const g = groups.find((q) => Math.abs(q.y0 - w.y0) < 1.5 && w.x0 - q.x1 < 6 && w.x0 > q.x0);
    if (g) {
      g.text += ` ${w.w}`;
      g.x1 = Math.max(g.x1, w.x1);
      g.y1 = Math.max(g.y1, w.y1);
    } else groups.push({ ...w, text: w.w });
  }
  return groups;
}

const boxDist = (x, y, g) => Math.hypot(Math.max(g.x0 - x, 0, x - g.x1), Math.max(g.y0 - y, 0, y - g.y1));

/**
 * Reserve-georeferanse fra gradnettetikettene (60°10'N, 011°00'E): etikettene står
 * midt på sine gradlinjer. Gir ca. 25–130 m nøyaktighet på 1:200–250 000-kart.
 */
export function gridFit(words) {
  const lat = [];
  const lon = [];
  for (const w of words) {
    const m = w.w.match(/^(\d{2,3})°(\d{2})'([NSEW])$/);
    if (!m) continue;
    const v = (+m[1] + +m[2] / 60) * (/[SW]/.test(m[3]) ? -1 : 1);
    (/[NS]/.test(m[3]) ? lat : lon).push([(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, v]);
  }
  const spread = (a) => a.length >= 3 && new Set(a.map((q) => Math.round(q[2] * 60))).size >= 2;
  if (!spread(lat) || !spread(lon)) return null;
  const cl = fitAffine(lat.map((q) => [q[0], q[1], 1]), lat.map((q) => q[2]));
  const co = fitAffine(lon.map((q) => [q[0], q[1], 1]), lon.map((q) => q[2]));
  const toLL = (x, y) => ({ lat: cl[0] * x + cl[1] * y + cl[2], lon: co[0] * x + co[1] * y + co[2] });
  const det = cl[0] * co[1] - cl[1] * co[0];
  const toXY = (la, lo) => {
    const A = la - cl[2];
    const B = lo - co[2];
    return [(co[1] * A - cl[1] * B) / det, (-co[0] * A + cl[0] * B) / det];
  };
  return { toLL, toXY };
}

/** Ord som ikke er stedsnavn (tekniske forkortelser på kartene). */
const NOT_NAME = /^(VFR|IFR|RMZ|TMZ|TIZ|TIA|CTR|TMA|CTA|ATZ|DME|VOR|NDB|FLS|ARP|RWY|AMSL|GND|MSL|FT|NM|KM|FL|ELEV|HGT|ALT|APP|TWR|AFIS|ATIS|SMC|CLR|NOTE|ONLY|HEL|RCF|HLDG|AND|THE|OF|TO|SEE|MAX|MNM|LIGHT ACFT|DVOR|DVOR\/DME)$/;

/**
 * @returns {{ points: {n, lat, lon, compulsory, src, accuracyM}[], georef: {residualM, controlPoints} | null }}
 */
export async function chartPoints(pdfBuf) {
  const dir = await mkdtemp(join(tmpdir(), 'vfrs-'));
  try {
    const pdf = join(dir, 'c.pdf');
    await writeFile(pdf, pdfBuf);
    const [{ stdout: text }, { stdout: bbox }, { stdout: svg }] = await Promise.all([
      run('pdftotext', ['-layout', pdf, '-'], BIG),
      run('pdftotext', ['-bbox', pdf, '-'], BIG),
      run('pdftocairo', ['-svg', pdf, '-'], BIG),
    ]);
    const table = parseChartPoints(text);
    const words = parseWords(bbox);
    const coordYs = words.filter((w) => /^\d*\d{6}(?:\.\d+)?[NS]$/.test(w.w)).map((w) => (w.y0 + w.y1) / 2);
    const inTable = (w) => coordYs.some((y) => Math.abs(y - (w.y0 + w.y1) / 2) < 3);
    // Tittelfeltet (over gradnettet øverst) har flyplassnavnet – ikke rapporteringspunkter.
    const topGrid = words.filter((w) => /^\d{3}°\d{2}'[EW]$/.test(w.w)).map((w) => w.y0);
    const headerY = topGrid.length ? Math.min(...topGrid) - 2 : 0;
    // Navaid-identer i «(R-344.7 TRO / DME 7.7)» under punktnavnene.
    const radialIdent = new Set(words.filter((w, i) => /^\(R-\d/.test(words[i - 1]?.w ?? '') && words[i + 1]?.w === '/').map((w) => w));
    const groups = labelGroups(words.filter((w) => !inTable(w) && w.y0 > headerY && !radialIdent.has(w)));
    const syms = findSymbols(svg);

    // 1) Tabellpunkt → symbol via etikett.
    const used = new Set();
    const ctrl = [];
    for (const p of table) {
      let best = null;
      for (const g of groups.filter((q) => q.text === p.n || q.text.startsWith(p.n + ' ') || p.n.startsWith(q.text))) {
        for (const s of syms) {
          const d = boxDist(s.x, s.y, g);
          if (d < 22 && !used.has(s) && (!best || d < best.d)) best = { d, s };
        }
      }
      if (best) {
        used.add(best.s);
        ctrl.push({ p, s: best.s });
      }
    }

    // 2) Georeferanse fra tabellpunktene (minste kvadrater, kast uteliggere).
    let fit = null;
    if (ctrl.length >= 4) {
      let set = ctrl;
      for (let it = 0; it < 6; it++) {
        const rows = set.map((c) => [c.p.lon, c.p.lat, 1]);
        const cx = fitAffine(rows, set.map((c) => c.s.x));
        const cy = fitAffine(rows, set.map((c) => c.s.y));
        const res = set.map((c, i) => Math.hypot(cx[0] * rows[i][0] + cx[1] * rows[i][1] + cx[2] - c.s.x, cy[0] * rows[i][0] + cy[1] * rows[i][1] + cy[2] - c.s.y));
        const worst = res.indexOf(Math.max(...res));
        fit = { cx, cy, res, set };
        if (res[worst] <= 5 || set.length <= 4) break;
        set = set.filter((_, i) => i !== worst);
      }
    }
    const project = fit ? (lat, lon) => [fit.cx[0] * lon + fit.cx[1] * lat + fit.cx[2], fit.cy[0] * lon + fit.cy[1] * lat + fit.cy[2]] : null;
    const unproject = fit
      ? (x, y) => {
          const { cx, cy } = fit;
          const det = cx[0] * cy[1] - cx[1] * cy[0];
          const X = x - cx[2];
          const Y = y - cy[2];
          return { lon: (cy[1] * X - cx[1] * Y) / det, lat: (-cy[0] * X + cx[0] * Y) / det };
        }
      : null;
    // Meter per punkt (pt) for nøyaktighetsangivelse.
    let mPerPt = null;
    let residualM = null;
    if (fit) {
      const a = unproject(0, 0);
      const b = unproject(100, 0);
      mPerPt = Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)) / 100;
      residualM = Math.round(Math.sqrt(fit.res.reduce((s, r) => s + r * r, 0) / fit.res.length) * mPerPt);
    }
    const good = fit && fit.set.length >= 5 && residualM <= 100;
    // Valgt georeferanse: tabellpunktene om de er gode nok, ellers gradnettet (ca. 150 m).
    const grid = good ? null : gridFit(words);
    const geo = good
      ? { toXY: project, toLL: unproject, accuracyM: Math.max(residualM, 50), how: 'tabell' }
      : grid
        ? { toXY: grid.toXY, toLL: grid.toLL, accuracyM: 150, how: 'gradnett' }
        : null;

    // 3) Obligatorisk/frivillig for tabellpunkter: symbol fra etikett, ellers nærmeste symbol ved projisert posisjon.
    const points = table.map((p) => {
      let sym = ctrl.find((c) => c.p === p)?.s ?? null;
      if (!sym && geo) {
        const [x, y] = geo.toXY(p.lat, p.lon);
        let best = null;
        for (const s of syms) {
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < (geo.how === 'tabell' ? 8 : 12) && (!best || d < best.d)) best = { d, s };
        }
        if (best) {
          sym = best.s;
          used.add(best.s);
        }
      }
      return { ...p, compulsory: sym ? sym.filled : null, src: 'table', accuracyM: null };
    });

    // 4) Symboler med navn på kartet men uten tabellrad: posisjon fra georeferansen.
    if (geo) {
      for (const s of syms) {
        if (used.has(s)) continue;
        let best = null;
        for (const g of groups) {
          // Ventemønstre (HLDG) er ikke rapporteringspunkter; korte ord er ofte avkuttede etiketter.
          if (NOT_NAME.test(g.text) || g.text.length < 4 || /^(HLDG|HOLD|RCF|DVOR|NOTE)\b/.test(g.text)) continue;
          const d = boxDist(s.x, s.y, g);
          if (d < 18 && (!best || d < best.d)) best = { d, g };
        }
        if (!best) continue;
        const name = best.g.text.replace(/\s+(DME|FLS)\b.*$/, '').trim();
        if (points.some((q) => q.n === name)) continue;
        const ll = geo.toLL(s.x, s.y);
        points.push({ n: name, lat: ll.lat, lon: ll.lon, compulsory: s.filled, src: 'chart', accuracyM: geo.accuracyM });
      }
    }
    return { points, georef: geo ? { how: geo.how, accuracyM: geo.accuracyM, controlPoints: fit?.set.length ?? 0 } : null, symbols: syms.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
