// Polaris FIR (ENOR) fra AIP Norge ENR 2.1. Grensestrekningene «along the border» mot
// Russland, Finland og Sverige hentes fra Natural Earth (world-atlas, 1:10 mill.).
// Brukes til å tegne SIGMET/AIRMET som gjelder hele eller deler av FIR-en.

import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);

const dms = (s) => {
  const m = s.match(/^(\d{2})(\d{2})(\d{2})([NS])\s*(\d{3})(\d{2})(\d{2})([EW])$/);
  return m ? [(+m[1] + +m[2] / 60 + +m[3] / 3600) * (m[4] === 'S' ? -1 : 1), (+m[5] + +m[6] / 60 + +m[7] / 3600) * (m[8] === 'W' ? -1 : 1)] : null;
};

/** Teksten etter «POLARIS FIR FIR:» frem til «Upper limit». */
export function parseFirText(text) {
  const i = text.search(/POLARIS FIR FIR:/i);
  if (i < 0) throw new Error('fant ikke POLARIS FIR i ENR 2.1');
  const part = text.slice(i, text.indexOf('Upper limit', i));
  // Del opp i punkter og «along the border»-strekninger.
  const tokens = part.split(' - ').map((t) => t.trim());
  const out = [];
  for (const t of tokens) {
    const c = t.match(/\d{6}[NS]\s*\d{7}[EW]/);
    if (/along the border/i.test(t)) out.push({ border: true });
    if (c && !/^\(/.test(t)) out.push({ pt: dms(c[0].replace(/\s+/g, '')) });
  }
  return out;
}

function norwayRing() {
  const topo = JSON.parse(require('fs').readFileSync(require.resolve('world-atlas/countries-10m.json'), 'utf8'));
  const no = feature(topo, topo.objects.countries).features.find((f) => f.properties.name === 'Norway');
  const polys = no.geometry.type === 'MultiPolygon' ? no.geometry.coordinates : [no.geometry.coordinates];
  // Fastlandet = største ytterring.
  const rings = polys.map((p) => p[0]);
  return rings.sort((a, b) => b.length - a.length)[0].map(([lon, lat]) => [lat, lon]);
}

const d2 = (a, b) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180)) ** 2;
const nearest = (ring, p) => ring.reduce((best, q, i) => (d2(q, p) < d2(ring[best], p) ? i : best), 0);

/** Korteste vei langs ringen fra a til b (landegrensen er mye kortere enn kysten). */
function pathAlong(ring, a, b) {
  const ia = nearest(ring, a);
  const ib = nearest(ring, b);
  const n = ring.length;
  const fwd = [];
  for (let i = ia; i !== ib; i = (i + 1) % n) fwd.push(ring[i]);
  const back = [];
  for (let i = ia; i !== ib; i = (i - 1 + n) % n) back.push(ring[i]);
  const len = (p) => p.reduce((s, q, i) => (i ? s + Math.sqrt(d2(q, p[i - 1])) : 0), 0);
  return (len(fwd) < len(back) ? fwd : back).slice(1);
}

export function buildFir(text) {
  const items = parseFirText(text);
  const ring = norwayRing();
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.pt) out.push(it.pt);
    else if (it.border) {
      const prev = out[out.length - 1];
      const next = items.slice(i + 1).find((x) => x.pt)?.pt;
      if (prev && next) out.push(...pathAlong(ring, prev, next));
    }
  }
  return out.map(([la, lo]) => [+la.toFixed(4), +lo.toFixed(4)]);
}

export async function fetchFir(get, root) {
  const html = (await get(`${root}EN-ENR-2.1-en-GB.html`)).text;
  const text = html.replace(/<span class="sdParams"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  return buildFir(text);
}

// Kjørt direkte: skriv public/data/fir.json (via proxy om HTTPS_PROXY er satt, som build-data.mjs).
const isMain = import.meta.url === `file://${process.argv[1]}`;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (isMain && proxy && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
} else if (isMain) {
  const { writeFile } = await import('node:fs/promises');
  const E = 'https://aim-prod.avinor.no/no/AIP';
  const h = await fetch(E);
  const t = await h.text();
  const base = h.url.replace(/[^/]*$/, '');
  const ed = t.match(/(\d{4}-\d{2}-\d{2})-AIRAC\/html\/index/)[1];
  const root = `${base}${ed}-AIRAC/html/eAIP/`;
  const get = async (u) => ({ text: await (await fetch(u)).text() });
  const ring = await fetchFir(get, root);
  await writeFile(new URL('../public/data/fir.json', import.meta.url), JSON.stringify({ edition: ed, source: 'AIP Norge ENR 2.1 + Natural Earth (landegrense)', ENOR: ring }));
  console.log(`Polaris FIR: ${ring.length} punkter (AIP ${ed})`);
}
