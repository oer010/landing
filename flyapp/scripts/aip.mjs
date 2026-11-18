// Henter flyplassfrekvenser (AD 2.18 «ATS communication facilities») fra
// Avinors offentlige eAIP for alle norske flyplasser i AIP AD 2.
//
// Uten ansvar: tolket automatisk fra HTML. Sjekk alltid gjeldende AIP.

const AIP_ENTRY = 'https://aim-prod.avinor.no/no/AIP';

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const text = (html) =>
  decode(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ; ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .replace(/(\s*;\s*)+/g, '; ')
    .replace(/^[\s;]+|[\s;]+$/g, '')
    .trim();

/** Fjerner skjulte tekniske felt og tekst som er strøket i gjeldende utgave. */
export function cleanAipHtml(html) {
  let s = html.replace(/<span class="sdParams"[^>]*>[\s\S]*?<\/span>/g, '');
  // Strøket tekst (kan være <del>, <span>, <tr> …) – fjern elementet med innhold.
  for (let i = 0; i < 5; i++)
    s = s.replace(/<(\w+)\b[^>]*AmdtDeletedAIRAC[^>]*>(?:(?!<\1\b)[\s\S])*?<\/\1>/g, '');
  return s;
}

/**
 * Tolker AD 2.18 for en flyplass.
 * @returns {{svc:string, call:string, mhz:number[], hr:string, rmk:string}[]}
 */
export function parseAd218(html, ident) {
  const start = html.indexOf(`id="${ident}-AD-2.18"`);
  if (start < 0) return [];
  let end = html.indexOf(`id="${ident}-AD-2.19"`, start);
  if (end < 0) end = start + 200000;
  const sec = cleanAipHtml(html.slice(start, end));
  const body = sec.slice(Math.max(0, sec.indexOf('<tbody')));
  const rows = [];
  let prev = null;
  for (const tr of body.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<td\b[\s\S]*?<\/td>/g) ?? []).map(text);
    if (!cells.length) continue;
    // Rader med færre celler (rowspan) arver tjeneste og kallesignal.
    let [svc, call, freq, hr, rmk] = cells.length >= 5 ? cells : ['', '', ...cells];
    svc = (svc ?? '').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').trim() || prev?.svc || '';
    call = (call ?? '').trim() || prev?.call || '';
    prev = { svc, call };
    // Bare VHF-taleband for sivil VFR: dropp nød (121.5), militær UHF og reservefrekvenser.
    const mhz = [...(freq ?? '').matchAll(/(\d{3}\.\d{1,3})\s*MHZ/gi)]
      .map((m) => Number(m[1]))
      .filter((f) => f >= 118 && f < 137 && Math.abs(f - 121.5) > 0.001);
    if (!mhz.length || /AVBL only when .* U\/S/i.test(rmk ?? '')) continue;
    rows.push({ svc, call, mhz, hr: hr ?? '', rmk: (rmk ?? '').replace(/^NIL$/i, '').slice(0, 160) });
  }
  return rows;
}

async function getRes(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function get(url) {
  const res = await getRes(url);
  return { url: res.url, text: await res.text() };
}

/** Gjeldende utgave og liste over flyplasser. */
async function currentEdition() {
  const hist = await get(AIP_ENTRY);
  const base = hist.url.replace(/[^/]*$/, '');
  const m = hist.text.match(/(\d{4}-\d{2}-\d{2})-AIRAC\/html\/index/);
  if (!m) throw new Error('fant ikke gjeldende AIP-utgave');
  const edition = m[1];
  const root = `${base}${edition}-AIRAC/html/eAIP/`;
  const menu = await get(`${root}EN-menu-en-GB.html`);
  const idents = [...new Set([...menu.text.matchAll(/EN-AD-2\.([A-Z]{4})-en-GB/g)].map((x) => x[1]))].sort();
  return { edition, base, root, idents };
}

/** 5-bokstavs IFR-punkter (ENR 4.4), for å skille dem fra VFR-punkter. */
async function ifrPointNames(root) {
  const t = (await get(`${root}EN-ENR-4.4-en-GB.html`)).text.replace(/<span class="sdParams"[^>]*>[\s\S]*?<\/span>/g, '');
  return new Set([...t.replace(/<[^>]+>/g, ' ').matchAll(/\b([A-Z]{5})\b\s+\d{6}/g)].map((m) => m[1]));
}

/**
 * Henter alt fra AIP Norge i én runde: frekvenser (AD 2.18) og VFR-rapporteringspunkter
 * fra VFR-/innflygingskartene. `ap` = Map ident → {lat, lon} for fornuftssjekk.
 */
export async function fetchAipData({ ap = new Map(), chartDir = null, concurrency = 6, log = console.log } = {}) {
  const { edition, base, root, idents } = await currentEdition();
  const airports = {};
  const pages = new Map();
  const queue = [...idents];
  const failed = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let id; (id = queue.shift()); ) {
        try {
          const page = await get(`${root}EN-AD-2.${id}-en-GB.html`);
          pages.set(id, page.text);
          const rows = parseAd218(page.text, id);
          if (rows.length) airports[id] = rows;
        } catch (e) {
          failed.push(id);
        }
      }
    }),
  );
  log(`AIP Norge ${edition}: frekvenser for ${Object.keys(airports).length}/${idents.length} flyplasser${failed.length ? ` (feilet: ${failed.join(', ')})` : ''}`);
  let vfr = null;
  try {
    const { buildVfrPoints } = await import('./vfr.mjs');
    const ifrNames = await ifrPointNames(root);
    vfr = await buildVfrPoints({ pages: [...pages].sort(), graphicsBase: `${base}${edition}-AIRAC/`, ifrNames, ap, get: getRes, chartDir, log });
  } catch (e) {
    log(`Advarsel: VFR-punkter feilet: ${e.message}`);
  }
  return { edition, source: 'AIP Norge (Avinor eAIP), AD 2.18', airports, vfr };
}
