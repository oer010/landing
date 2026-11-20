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
export async function fetchAipData({ ap = new Map(), concurrency = 6, log = console.log } = {}) {
  const { edition, base, root, idents } = await currentEdition();
  const airports = {};
  const phones = {};
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
          const ph = parsePhones(page.text);
          if (ph.length) phones[id] = ph;
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
    vfr = await buildVfrPoints({ pages: [...pages].sort(), graphicsBase: `${base}${edition}-AIRAC/`, ifrNames, ap, get: getRes, log });
  } catch (e) {
    log(`Advarsel: VFR-punkter feilet: ${e.message}`);
  }
  return { edition, source: 'AIP Norge (Avinor eAIP), AD 2.18', airports, phones, vfr };
}

/**
 * Telefonnumre fra flyplassens AIP-side med etikett (TWR/AFIS/ATC, PPR, administrasjon, MET).
 * Numrene står spredt (AD 2.2, 2.11, 2.20, 2.22), så etiketten tas fra teksten rett foran nummeret.
 * @returns {{ label: string, tel: string, kind: 'atc'|'ppr'|'admin'|'met'|'other' }[]}
 */
export function parsePhones(html) {
  const s = cleanAipHtml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  const byNum = new Map();
  const order = { atc: 0, ppr: 1, admin: 2, met: 3, other: 4 };
  // Norske nummer: 8 siffer (evt. med +47), gruppert 2-2-2-2, 3-2-3 eller 3-5.
  const re = /(?:\(\+47\)\s*|\+47\s*)?(\d{2}\s?\d{2}\s?\d{2}\s?\d{2}|\d{3}\s?\d{2}\s?\d{3}|\d{3}\s?\d{5})(?!\d)/g;
  for (const m of s.matchAll(re)) {
    const digits = m[1].replace(/\s/g, '');
    if (digits.length !== 8) continue;
    const before = s.slice(Math.max(0, m.index - 140), m.index);
    // Bare numre som er merket som telefon (ikke koordinater, postnummer o.l.).
    if (!/(TEL|TLF|Telephone|Phone|Sentralbord|Switchboard|call|AFIS|CIV\/OPR|MIL|ADMIN|tel\.?)[^0-9]{0,40}(\(\+47\)|\+47)?\s*$/i.test(before) && !/\(\+47\)|\+47/.test(m[0])) continue;
    if (/FAX:?\s*(\(\+47\)|\+47)?\s*$/i.test(before)) continue;
    // Etikett: teksten fra forrige setning/punkt frem til nummeret.
    let label = before
      .split(/(?:\.\s|\d\.\d+\s|\s\d{1,2}\s(?=[A-Z])|:\s(?=[A-Z][a-z]))/)
      .pop()
      .replace(/\s*(?:TEL|TLF|Telephone|tel)\.?:?\s*$/i, '')
      .replace(/\s*(\(\+47\)|\+47)\s*$/, '')
      .replace(/\s+[/,]\s*$/, '')
      .trim();
    if (label.length > 70) label = `…${label.slice(-68)}`;
    const ctx = `${before.slice(-90)} `;
    if (/AIS briefing|CENTRAL AIS|Scheduling Coordinator|slot/i.test(ctx)) continue;
    // Typen avgjøres av nøkkelordet nærmest foran nummeret.
    const KINDS = [
      ['atc', /\b(TWR|Tower|ATC|ATS|AFIS|Supervisor|Approach|APP|Flygeled\w*|kontrolltårn|Control)\b/gi],
      ['ppr', /\bPPR\b/gi],
      ['met', /\b(MWO|MET|Værvarsl\w*)/gi],
      ['admin', /(Administration|Telephone|Sentralbord|Switchboard|Admin)/gi],
    ];
    let kind = 'other';
    let at = -1;
    let word = '';
    for (const [k, rx] of KINDS)
      for (const mm of ctx.matchAll(rx))
        if (mm.index > at) {
          at = mm.index;
          kind = k;
          word = mm[0];
        }
    // «call … TWR» er sterkere enn en AFIS-/ATS-omtale i samme setning som noe annet.
    const rank = order[kind] - (kind === 'atc' && /^(TWR|Tower|Supervisor)$/i.test(word) ? 0.5 : 0);
    const prev = byNum.get(digits);
    // Samme nummer flere steder: behold den mest relevante etiketten (TWR før PPR før admin …).
    if (!prev || rank < prev.rank) byNum.set(digits, { label: label || 'Telefon', tel: `+47 ${digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')}`, kind, rank });
  }
  const out = [...byNum.values()].sort((a, b) => a.rank - b.rank).map(({ rank, ...p }) => (void rank, p));
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 10);
}
