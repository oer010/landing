// VFR-rapporteringspunkter fra AIP Norge: koordinattabellene på Visual Approach
// Charts / VFR-kart (AD 2 XXXX 6-x, PDF). Krever `pdftotext` (poppler-utils).
//
// IFR-punkter (5-bokstavs navn i ENR 4.4) som også står på innflygingskart fjernes,
// unntatt på rene VFR-kart der de brukes som VFR-rutepunkter.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chartPoints } from './vfrsymbols.mjs';

const run = promisify(execFile);
const fold = (t) => t.toUpperCase().normalize('NFC');
const R = 3440.065;
const toRad = Math.PI / 180;
const distNm = (a, b) => {
  const h = Math.sin(((b.lat - a.lat) * toRad) / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(((b.lon - a.lon) * toRad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Hindertall kan stå klistret inntil koordinaten i PDF-teksten («1726595100N») – hopp over dem.
// …og et hindertall kan stå mellom navn og koordinat («BERG 4344 693418N»).
const COORD = /([A-ZÆØÅ][A-ZÆØÅa-zæøå0-9\-./ ]{1,32}?)\s+(?:\d{2,5}\s+)?(?:\d+(?=\d{6}(?:\.\d+)?[NS]))?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s+(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])/g;

/** Navn + koordinater fra tekst på et kart. */
export function parseChartPoints(text) {
  const out = [];
  for (const m of text.matchAll(COORD)) {
    let name = m[1].replace(/\s+/g, ' ').trim();
    // Høydetall/hinder etter navnet («NYLAND 1129»), og «|»-rester.
    name = name.replace(/(\s+\d+)+$/, '').replace(/^[|\s]+/, '').trim();
    // Søppel: må ha et ord med minst tre bokstaver, og ikke være teknisk tekst.
    if (!/[A-ZÆØÅ]{3,}/.test(name) || /^(GND|AMSL|HLDG|MSL|FL|MA)\b/.test(name)) continue;
    const lat = +m[2] + +m[3] / 60 + +m[4] / 3600;
    const lon = +m[6] + +m[7] / 60 + +m[8] / 3600;
    out.push({ n: name, lat: m[5] === 'S' ? -lat : lat, lon: m[9] === 'W' ? -lon : lon });
  }
  return out;
}

export const isVfrChart = (title) => /^VFR\b|VFR[- ]Routes|VFR Chart|VFR Traffic/i.test(title);

/** Kart i AD 2.24 som gjelder visuell flyging. */
export function vfrCharts(html, ident) {
  const a = html.indexOf(`id="${ident}-AD-2.24"`);
  const b = html.indexOf(`id="${ident}-AD-2.25"`, a);
  if (a < 0) return [];
  const sec = html.slice(a, b > 0 ? b : a + 300000).replace(/<span class="sdParams"[^>]*>[\s\S]*?<\/span>/g, '');
  const out = [];
  for (const row of sec.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []) {
    const title = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const href = row.match(/href="\.\.\/\.\.\/(graphics\/[^"]+\.pdf)"/)?.[1];
    if (href && /Visual Approach Chart|^VFR|VFR[- ]|Visual flight rules/i.test(title) && !/Surface Penetrations/i.test(title))
      out.push({ title: title.replace(/\s*AD 2 [A-Z]{4}.*$/, '').trim(), page: title.match(/AD 2 [A-Z]{4} [\d -]+/)?.[0]?.trim() ?? '', href });
  }
  return out;
}

async function pdfText(buf) {
  const dir = await mkdtemp(join(tmpdir(), 'vac-'));
  try {
    const f = join(dir, 'c.pdf');
    await writeFile(f, buf);
    const { stdout } = await run('pdftotext', ['-layout', f, '-'], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * @param pages  Map ident → AD 2-HTML (allerede hentet)
 * @param ifrNames  Set med 5-bokstavs IFR-punkter (ENR 4.4)
 * @param ap  Map ident → {lat, lon} (flyplassens posisjon, for fornuftssjekk)
 */
export async function buildVfrPoints({ pages, graphicsBase, ifrNames, ap, get, chartDir = null, log = console.log }) {
  try {
    await run('pdftotext', ['-v']);
  } catch {
    log('Advarsel: pdftotext mangler (installer poppler-utils) – hopper over VFR-rapporteringspunkter');
    return null;
  }
  const points = [];
  const charts = {};
  const overlays = [];
  let pdfs = 0;
  const georef = chartDir ? (await import('./vfrcharts.mjs')).georefChart : null;
  if (chartDir) await (await import('node:fs/promises')).mkdir(chartDir, { recursive: true });
  for (const [ident, html] of pages) {
    const list = vfrCharts(html, ident);
    if (list.length) charts[ident] = list.map((c) => ({ title: c.title, page: c.page, url: graphicsBase + c.href }));
    for (const c of list) {
      let text;
      let buf;
      try {
        buf = Buffer.from(await (await get(graphicsBase + c.href, true)).arrayBuffer());
        text = await pdfText(buf);
        pdfs++;
      } catch (e) {
        log(`  ${ident}: kunne ikke lese ${c.title}: ${e.message}`);
        continue;
      }
      const vfrOnly = isVfrChart(c.title);
      // Rene VFR-kart (ruter, helikopter, VFR-kart) legges oppå kartet når de kan georefereres presist.
      if (georef && vfrOnly) {
        const file = `${ident}-${overlays.filter((o) => o.ad === ident).length + 1}.jpg`;
        try {
          const g = await georef(buf, join(chartDir, file));
          if (g && g.controlPoints >= 6 && g.residualM <= 80) {
            overlays.push({ ad: ident, title: c.title, page: c.page, img: `vfrcharts/${file}`, tl: g.tl, tr: g.tr, bl: g.bl, accuracyM: g.residualM, controlPoints: g.controlPoints });
            log(`  ${ident} ${c.title}: lagt over kartet (±${g.residualM} m, ${g.controlPoints} punkter)`);
          } else {
            await rm(join(chartDir, file), { force: true });
            log(`  ${ident} ${c.title}: ikke presis nok til å legges over kartet${g ? ` (±${g.residualM} m, ${g.controlPoints} punkter)` : ''}`);
          }
        } catch (e) {
          log(`  ${ident} ${c.title}: georeferering feilet: ${e.message}`);
        }
      }
      // Symboler på kartet: obligatorisk (▲) / på forespørsel (△), og punkter som bare står på kartet.
      let found;
      try {
        found = (await chartPoints(buf)).points;
      } catch (e) {
        log(`  ${ident} ${c.title}: symbollesing feilet (${e.message}) – bruker bare tabellen`);
        found = parseChartPoints(text).map((p) => ({ ...p, compulsory: null, src: 'table', accuracyM: null }));
      }
      const adName = fold(ap.get(ident)?.name ?? '');
      for (const p of found) {
        if (!vfrOnly && /^[A-Z]{5}$/.test(p.n) && ifrNames.has(p.n)) continue;
        // Navn lest fra kartet som er flyplassens eget navn (f.eks. «HAUKÅSEN» ved Sogndal) er ikke punkter.
        if (p.src === 'chart' && adName && fold(p.n).split(' ').every((w) => adName.includes(w))) continue;
        const pos = ap.get(ident);
        if (pos && distNm(pos, p) > 45) continue; // feiltolket koordinat
        const dup = points.find((q) => q.n === p.n && distNm(q, p) < (p.src === 'chart' || q.src === 'chart' ? 1 : 0.2));
        if (dup) {
          if (!dup.ad.includes(ident)) dup.ad.push(ident);
          if (p.compulsory !== null) {
            dup.c = dup.c === 1 || p.compulsory ? 1 : 0;
            dup.cad = { ...(dup.cad ?? {}), [ident]: p.compulsory ? 1 : 0 };
          }
          // Tabellkoordinat slår posisjon lest fra kartet.
          if (dup.src === 'chart' && p.src === 'table') Object.assign(dup, { lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), src: 'table', acc: undefined });
          continue;
        }
        points.push({
          n: p.n,
          lat: +p.lat.toFixed(5),
          lon: +p.lon.toFixed(5),
          ad: [ident],
          // c: 1 = obligatorisk, 0 = på forespørsel, utelatt = ukjent
          ...(p.compulsory === null ? {} : { c: p.compulsory ? 1 : 0, cad: { [ident]: p.compulsory ? 1 : 0 } }),
          src: p.src,
          ...(p.src === 'chart' ? { acc: p.accuracyM } : {}),
        });
      }
    }
  }
  log(`VFR: ${points.length} rapporteringspunkter (${points.filter((p) => p.c === 1).length} obligatoriske, ${points.filter((p) => p.src === 'chart').length} lest fra kartsymbol) fra ${pdfs} kart (${Object.keys(charts).length} flyplasser med VFR-kart), ${overlays.length} VFR-kart lagt over kartet`);
  return { points, charts, overlays };
}
