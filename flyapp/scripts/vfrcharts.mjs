// Georefererer offisielle VFR-rutekart fra AIP Norge slik at de kan legges oppå
// kartet i appen. Kontrollpunkter: rapporteringspunktenes trekant-symboler på
// kartet koblet til koordinattabellen på samme kart. Krever poppler (pdftotext,
// pdftocairo).

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseChartPoints } from './vfr.mjs';

const run = promisify(execFile);
const BIG = { maxBuffer: 256 * 1024 * 1024 };

/** Løser 3×3 lineært system (Gauss). */
function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Minste kvadraters affin: (lon, lat, 1) → v. */
export function fitAffine(rows, values) {
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Atb = [0, 0, 0];
  rows.forEach((r, i) => {
    for (let a = 0; a < 3; a++) {
      Atb[a] += r[a] * values[i];
      for (let b = 0; b < 3; b++) AtA[a][b] += r[a] * r[b];
    }
  });
  return solve3(AtA, Atb);
}

const dot = (c, r) => c[0] * r[0] + c[1] * r[1] + c[2];

function parseWords(bboxHtml) {
  return [...bboxHtml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
    x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], w: m[5].replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  }));
}

/** Små lukkede trekanter (rapporteringspunkt-symboler) i sidekoordinater (pt). */
function findTriangles(svg) {
  const out = [];
  // Bare tegnet innhold (ikke skrift-definisjoner i <defs>), med tynn svart kant.
  const body = svg.slice(svg.indexOf('</defs>') + 1);
  for (const p of body.match(/<path[^>]*\/>/g) ?? []) {
    if (!/stroke="rgb\(0%, 0%, 0%\)"/.test(p)) continue;
    const tm = p.match(/transform="matrix\(([^)]*)\)"/);
    const d = p.match(/ d="([^"]+)"/)?.[1];
    if (!d) continue;
    const [a, b, c, dd, e, f] = tm ? tm[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    for (const sub of d.split(/(?=M)/)) {
      if (!/Z/.test(sub)) continue;
      const nums = [...sub.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]);
      if (/C/.test(sub) || nums.length < 6 || nums.length > 10) continue;
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([a * nums[i] + c * nums[i + 1] + e, b * nums[i] + dd * nums[i + 1] + f]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      // Rapporteringspunkt-trekanten er ca. 8–9 pt; hindersymboler (Λ) er mindre og åpne.
      if (w > 6 && w < 12 && h > 5 && h < 11) out.push([xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length]);
    }
  }
  return out;
}

/** Kartramme fra gradnettetikettene (60°10'N / 011°00'E) rundt kartet. */
function mapFrame(words, pageW, pageH) {
  const lat = words.filter((w) => /^\d{2}°\d{2}'[NS]$/.test(w.w));
  const lon = words.filter((w) => /^\d{3}°\d{2}'[EW]$/.test(w.w));
  if (lat.length < 2 || lon.length < 2) return null;
  const left = lat.filter((w) => w.x1 < pageW / 2);
  const right = lat.filter((w) => w.x0 > pageW / 2);
  const top = lon.filter((w) => w.y1 < pageH / 2);
  const bottom = lon.filter((w) => w.y0 > pageH / 2);
  if (!left.length || !right.length || !top.length || !bottom.length) return null;
  return {
    x0: Math.max(...left.map((w) => w.x1)) + 1,
    x1: Math.min(...right.map((w) => w.x0)) - 1,
    y0: Math.max(...top.map((w) => w.y1)) + 1,
    y1: Math.min(...bottom.map((w) => w.y0)) - 1,
  };
}

/**
 * Georefererer ett kart og lagrer kartflaten som JPEG.
 * @returns {{ img, tl, tr, bl, residualM, controlPoints } | null}
 */
export async function georefChart(pdfBuf, outFile, { dpi = 170, log = () => {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vfrc-'));
  try {
    const pdf = join(dir, 'c.pdf');
    await writeFile(pdf, pdfBuf);
    const [{ stdout: text }, { stdout: bbox }, { stdout: svg }] = await Promise.all([
      run('pdftotext', ['-layout', pdf, '-'], BIG),
      run('pdftotext', ['-bbox', pdf, '-'], BIG),
      run('pdftocairo', ['-svg', pdf, '-'], BIG),
    ]);
    const pts = parseChartPoints(text);
    const words = parseWords(bbox);
    const page = bbox.match(/<page width="([\d.]+)" height="([\d.]+)"/);
    const pageW = +page[1];
    const pageH = +page[2];
    // Etiketter på kartet (ikke tabellraden der koordinaten står på samme linje).
    const coordYs = words.filter((w) => /^\d*\d{6}[NS]$/.test(w.w)).map((w) => (w.y0 + w.y1) / 2);
    const inTable = (w) => coordYs.some((y) => Math.abs(y - (w.y0 + w.y1) / 2) < 3);
    const tris = findTriangles(svg);
    const ctrl = [];
    for (const p of pts) {
      const first = p.n.split(' ')[0];
      let best = null;
      for (const L of words.filter((w) => w.w === first && !inTable(w))) {
        const lx = (L.x0 + L.x1) / 2;
        const ly = (L.y0 + L.y1) / 2;
        for (const t of tris) {
          const d = Math.hypot(t[0] - lx, t[1] - ly);
          if (d < 28 && (!best || d < best.d)) best = { d, t };
        }
      }
      if (best && !ctrl.some((c) => c.t === best.t)) ctrl.push({ p, t: best.t });
    }
    if (ctrl.length < 4) {
      log(`    for få kontrollpunkter (${ctrl.length})`);
      return null;
    }
    // Tilpass, fjern dårligste uteligger så lenge den er > 6 pt, tilpass igjen.
    let set = ctrl;
    let cx, cy, res;
    for (let iter = 0; iter < 6; iter++) {
      const rows = set.map((c) => [c.p.lon, c.p.lat, 1]);
      cx = fitAffine(rows, set.map((c) => c.t[0]));
      cy = fitAffine(rows, set.map((c) => c.t[1]));
      res = set.map((c, i) => Math.hypot(dot(cx, rows[i]) - c.t[0], dot(cy, rows[i]) - c.t[1]));
      const worst = res.indexOf(Math.max(...res));
      if (res[worst] <= 6 || set.length <= 4) break;
      set = set.filter((_, i) => i !== worst);
    }
    const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
    const frame = mapFrame(words, pageW, pageH);
    if (!frame) {
      log('    fant ikke kartrammen');
      return null;
    }
    // Invers: sidekoordinat (x, y) → (lon, lat).
    const det = cx[0] * cy[1] - cx[1] * cy[0];
    const toLL = (x, y) => {
      const X = x - cx[2];
      const Y = y - cy[2];
      return [(cy[1] * X - cx[1] * Y) / det, (-cy[0] * X + cx[0] * Y) / det].reverse(); // [lat, lon]
    };
    // Uavhengig kontroll: gradnettetikettene (60°10'N, 011°00'E) står midt på sine gradlinjer.
    const dms = (t) => {
      const m = t.match(/^(\d{2,3})°(\d{2})'([NSEW])$/);
      return m ? (+m[1] + +m[2] / 60) * (/[SW]/.test(m[3]) ? -1 : 1) : null;
    };
    const gridErr = [];
    for (const w of words) {
      const v = dms(w.w);
      if (v === null) continue;
      const cxw = (w.x0 + w.x1) / 2;
      const cyw = (w.y0 + w.y1) / 2;
      if (/[NS]$/.test(w.w)) {
        // Breddegrad: midten av etiketten i høyden, ved kartkanten.
        const x = cxw < pageW / 2 ? frame.x0 : frame.x1;
        gridErr.push(Math.abs(toLL(x, cyw)[0] - v) * 111320);
      } else {
        const y = cyw < pageH / 2 ? frame.y0 : frame.y1;
        const [la, lo] = toLL(cxw, y);
        gridErr.push(Math.abs(lo - v) * 111320 * Math.cos((la * Math.PI) / 180));
      }
    }
    const gridErrM = gridErr.length ? Math.round(Math.max(...gridErr)) : null;
    const s = dpi / 72;
    const base = join(dir, 'img');
    await run('pdftocairo', ['-jpeg', '-jpegopt', 'quality=72', '-r', String(dpi), '-singlefile',
      '-x', String(Math.round(frame.x0 * s)), '-y', String(Math.round(frame.y0 * s)),
      '-W', String(Math.round((frame.x1 - frame.x0) * s)), '-H', String(Math.round((frame.y1 - frame.y0) * s)), pdf, base], BIG);
    await writeFile(outFile, await readFile(`${base}.jpg`));
    // Skala: meter per pt ved kartets midte.
    const [la0, lo0] = toLL(frame.x0, frame.y0);
    const [la1, lo1] = toLL(frame.x1, frame.y0);
    const mPerPt = (Math.hypot((la1 - la0) * 111320, (lo1 - lo0) * 111320 * Math.cos((la0 * Math.PI) / 180)) / (frame.x1 - frame.x0));
    const r5 = (v) => Math.round(v * 1e5) / 1e5;
    return {
      tl: toLL(frame.x0, frame.y0).map(r5),
      tr: toLL(frame.x1, frame.y0).map(r5),
      bl: toLL(frame.x0, frame.y1).map(r5),
      residualM: Math.round(rms * mPerPt),
      gridErrM,
      controlPoints: set.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
