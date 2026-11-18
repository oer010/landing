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

/** Stier i sidekoordinater med kurver samplet, for linjer med gitt farge. */
function strokePaths(svg) {
  const body = svg.slice(svg.indexOf('</defs>') + 1);
  const out = [];
  for (const p of body.match(/<path[^>]*\/>/g) ?? []) {
    const stroke = p.match(/stroke="([^"]+)"/)?.[1] ?? null;
    const fill = p.match(/fill="([^"]+)"/)?.[1] ?? null;
    const d = p.match(/ d="([^"]+)"/)?.[1];
    if (!d) continue;
    const tm = p.match(/transform="matrix\(([^)]*)\)"/);
    const [a, b, c, dd, e, f] = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    const T = (x, y) => [a * x + c * y + e, b * x + dd * y + f];
    const width = +(p.match(/stroke-width="([^"]+)"/)?.[1] ?? 0) * Math.abs(a);
    const toks = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
    let cur = null;
    let cmd = null;
    const flush = (closed) => {
      if (cur && cur.length > 1) out.push({ pts: cur, closed, stroke, fill, width });
      cur = null;
    };
    for (let i = 0; i < toks.length; ) {
      const t = toks[i];
      if (/[MLCZ]/.test(t)) {
        cmd = t;
        i++;
        if (t === 'M') flush(false);
        if (t === 'Z') flush(true);
        continue;
      }
      if (cmd === 'M' || cmd === 'L') {
        const q = T(+toks[i], +toks[i + 1]);
        (cur ??= []).push(q);
        i += 2;
      } else if (cmd === 'C') {
        const p0 = cur?.[cur.length - 1];
        const [p1, p2, p3] = [T(+toks[i], +toks[i + 1]), T(+toks[i + 2], +toks[i + 3]), T(+toks[i + 4], +toks[i + 5])];
        if (p0)
          for (let k = 1; k <= 8; k++) {
            const u = k / 8;
            const m = 1 - u;
            cur.push([m * m * m * p0[0] + 3 * m * m * u * p1[0] + 3 * m * u * u * p2[0] + u * u * u * p3[0], m * m * m * p0[1] + 3 * m * m * u * p1[1] + 3 * m * u * u * p2[1] + u * u * u * p3[1]]);
          }
        i += 6;
      } else i++;
    }
    flush(false);
  }
  return out;
}

const segDist = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const polyDist = (p, pts) => Math.min(...pts.slice(1).map((q, i) => segDist(p, pts[i], q)));

/**
 * VFR-ruter på et rutekart: tykke svarte linjer (≈1,4–1,6 pt) der begge ender ligger ved
 * et rapporteringspunkt; pilspisser gir retning; «MAX 1000»/«MNM 1500» langs linjen gir høyde.
 */
function extractRoutes({ svg, words, syms, text, holds = [] }) {
  const paths = strokePaths(svg);
  const near = (q) => Math.min(...syms.map((s) => Math.hypot(s.x - q[0], s.y - q[1])));
  const lines = paths.filter((P) => !P.closed && P.stroke === BLACK && P.width > 1.2 && P.width < 1.7);
  // Pilspisser: små fylte svarte figurer – ikke de fylte rapporteringspunkt-trekantene.
  const heads = paths
    .filter((P) => P.closed && P.fill === BLACK)
    .map((P) => {
      const xs = P.pts.map((q) => q[0]);
      const ys = P.pts.map((q) => q[1]);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    })
    .filter((q) => q.w > 2 && q.w < 7.5 && q.h > 2 && q.h < 7.5 && near([q.x, q.y]) > 5);
  // Høydeetiketter. Rotert tekst kan være delt («15»+«00», «MA»+«X»): sett sammen bitene,
  // og velg tallet som er et rimelig VFR-rutehøyde (multiplum av 500 ft, 500–5000).
  const ctr = (w) => [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
  const keys = [];
  words.forEach((k, i) => {
    if (/^(MAX|MNM|MIN)$/.test(k.w)) keys.push({ kind: k.w === 'MAX' ? 'max' : 'min', at: ctr(k) });
    else if (k.w === 'MA' && words.some((x) => x.w === 'X' && Math.hypot(ctr(x)[0] - ctr(k)[0], ctr(x)[1] - ctr(k)[1]) < 9)) keys.push({ kind: 'max', at: ctr(k) });
    else if (k.w === 'M' && words.some((x) => x.w === 'AX' && Math.hypot(ctr(x)[0] - ctr(k)[0], ctr(x)[1] - ctr(k)[1]) < 9)) {
      const ax = words.find((x) => x.w === 'AX' && Math.hypot(ctr(x)[0] - ctr(k)[0], ctr(x)[1] - ctr(k)[1]) < 9);
      keys.push({ kind: 'max', at: [(ctr(k)[0] + ctr(ax)[0]) / 2, (ctr(k)[1] + ctr(ax)[1]) / 2] });
    }
    void i;
  });
  const ok = (v) => v >= 500 && v <= 5000 && v % 500 === 0;
  const alts = [];
  for (const k of keys) {
    const digits = words.filter((w) => /^\d{1,4}$/.test(w.w) && Math.hypot(ctr(w)[0] - k.at[0], ctr(w)[1] - k.at[1]) < 24);
    let ft = null;
    for (const d of digits) if (ok(+d.w)) ft = +d.w;
    if (ft === null)
      for (const x of digits)
        for (const y of digits) if (x !== y && ok(+(x.w + y.w)) && Math.hypot(ctr(x)[0] - ctr(y)[0], ctr(x)[1] - ctr(y)[1]) < 12) ft = +(x.w + y.w);
    if (ft !== null) alts.push({ kind: k.kind, ft, x: k.at[0], y: k.at[1] });
  }
  // Høyder rett under et punktnavn gjelder punktet («STEINVIK MAX 2000»).
  const nameAbove = (t) =>
    words.find((w) => /^[A-ZÆØÅ]{3,}$/.test(w.w) && !/^(MAX|MNM|MIN|ALT|FT)$/.test(w.w) && t.y - ctr(w)[1] > 3 && t.y - ctr(w)[1] < 11 && Math.abs(ctr(w)[0] - t.x) < 30);
  const pointAlts = {};
  const lineAlts = [];
  for (const t of alts) {
    // Ved et venteområde (HLDG): høyden gjelder venteområdet.
    const hold = holds.find((h) => Math.hypot(h.x - t.x, h.y - t.y) < 16);
    if (hold) {
      pointAlts[hold.n] = { [t.kind]: t.ft };
      continue;
    }
    const nm = nameAbove(t);
    if (nm) pointAlts[nm.w] = { [t.kind]: t.ft };
    else lineAlts.push(t);
  }
  // Felles merknad på kartet, f.eks. «MAX ALT LIGHT ACFT 1000 FT WESTERN PART OF CTR …».
  // Felles merknad («MAX ALT LIGHT ACFT / 1000 FT WESTERN PART OF CTR / 1500 FT EASTERN …»):
  // les samme tekstkolonne nedover, siden andre kartetiketter kan stå lenger ut på linjene.
  let noteText = null;
  const textLines = text.split('\n');
  const li = textLines.findIndex((l) => /MAX(?:IMUM)? ALT/.test(l));
  if (li >= 0) {
    const col = textLines[li].search(/MAX(?:IMUM)? ALT/);
    const part = (l) => (l ?? '').slice(Math.max(0, col - 12), col + 40).trim().replace(/\s{2,}.*$/, '');
    const out = [part(textLines[li])];
    for (let k = li + 1; k <= li + 6; k++) {
      const t = part(textLines[k]);
      if (/\b(FT|PART|CTR|ACFT)\b/.test(t)) out.push(t);
    }
    noteText = out.join(' · ');
  }
  const nearEnd = (q) => Math.min(near(q), ...holds.map((h) => Math.hypot(h.x - q[0], h.y - q[1])));
  const routeLines = lines.filter((L) => {
    const a = L.pts[0];
    const b = L.pts[L.pts.length - 1];
    return Math.min(nearEnd(a), nearEnd(b)) <= 20 && Math.max(nearEnd(a), nearEnd(b)) <= 35;
  });
  // Etikett ↔ linje én-til-én, korteste avstand først, og bare tett ved linjen.
  const pairs = [];
  lineAlts.forEach((t, ti) => routeLines.forEach((L, li) => pairs.push({ ti, li, d: polyDist([t.x, t.y], L.pts) })));
  pairs.sort((x, y) => x.d - y.d);
  const labelOf = new Map();
  const usedT = new Set();
  for (const pr of pairs) {
    if (pr.d > 14 || usedT.has(pr.ti) || labelOf.has(pr.li)) continue;
    usedT.add(pr.ti);
    labelOf.set(pr.li, lineAlts[pr.ti]);
  }
  const routes = routeLines.map((L, li) => {
    const a = L.pts[0];
    const b = L.pts[L.pts.length - 1];
    const headAt = (q) => heads.some((h) => Math.hypot(h.x - q[0], h.y - q[1]) < 7);
    const label = labelOf.get(li);
    return { pts: L.pts, arrowStart: headAt(a), arrowEnd: headAt(b), alt: label ? { [label.kind]: label.ft } : null };
  });
  return { routes, note: noteText, pointAlts };
}

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
    const words = parseWords(bbox);
    const table = parseChartPoints(text);
    // Reserve: tabellrader lest fra ordposisjoner (navn til venstre for koordinatene på samme høyde).
    // Fanger rader der layout-teksten er forskjøvet av andre kartetiketter («HLDG NORTH»).
    for (const lat of words) {
      const mLat = lat.w.match(/^\d*?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])$/);
      if (!mLat) continue;
      const cy = (lat.y0 + lat.y1) / 2;
      const lon = words.find((w) => /^\d{7}(?:\.\d+)?[EW]$/.test(w.w) && Math.abs((w.y0 + w.y1) / 2 - cy) < 2 && w.x0 > lat.x1 && w.x0 - lat.x1 < 40);
      if (!lon) continue;
      const name = words
        .filter((w) => Math.abs((w.y0 + w.y1) / 2 - cy) < 2 && w.x1 < lat.x0 && lat.x0 - w.x1 < 120 && /^[A-ZÆØÅ][A-ZÆØÅ\-.]*$/.test(w.w))
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.w)
        .join(' ');
      if (!name || table.some((t) => t.n === name)) continue;
      const mLon = lon.w.match(/^(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])$/);
      const la = +mLat[1] + +mLat[2] / 60 + +mLat[3] / 3600;
      const lo = +mLon[1] + +mLon[2] / 60 + +mLon[3] / 3600;
      table.push({ n: name, lat: mLat[4] === 'S' ? -la : la, lon: mLon[4] === 'W' ? -lo : lo });
    }
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
    // VFR-ruter (bare med presis georeferanse fra tabellpunktene).
    let routes = [];
    let routeNote = null;
    if (geo && geo.how === 'tabell') {
      const holds = table.filter((p) => /^HLDG\b/.test(p.n)).map((p) => {
        const [x, y] = geo.toXY(p.lat, p.lon);
        return { n: p.n, x, y };
      });
      const r = extractRoutes({ svg, words, syms, text, holds });
      routeNote = r.note;
      // Høyder ved punkter («STEINVIK MAX 2000»).
      for (const p of points) if (r.pointAlts[p.n]) p.alt = r.pointAlts[p.n];
      const r5 = (v) => Math.round(v * 1e5) / 1e5;
      routes = r.routes.map((rt) => ({
        pts: rt.pts.map(([x, y]) => {
          const ll = geo.toLL(x, y);
          return [r5(ll.lat), r5(ll.lon)];
        }),
        arrowStart: rt.arrowStart,
        arrowEnd: rt.arrowEnd,
        alt: rt.alt,
        accuracyM: geo.accuracyM,
      }));
    }
    return { points, routes, routeNote, georef: geo ? { how: geo.how, accuracyM: geo.accuracyM, controlPoints: fit?.set.length ?? 0 } : null, symbols: syms.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
