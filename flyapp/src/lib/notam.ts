// NOTAM i ICAO-format: tolkning av Q-linjen, tidsrom, høyder og geometri fra E-feltet.

export interface RawNotam {
  loc: string;
  msg: string;
}

export type NotamGeom =
  | { type: 'polygon'; pts: [number, number][] }
  | { type: 'circle'; lat: number; lon: number; rNm: number }
  | { type: 'point'; lat: number; lon: number };

export interface Notam {
  id: string;
  /** A)-feltet (kan være flere steder). */
  locs: string[];
  fir: string;
  /** NOTAM-kode, f.eks. QRTCA (restriksjonsområde aktivert). */
  code: string;
  scope: string;
  /** Høyder i fot (Q-linjen er i FL; 000 = bakken). */
  lowerFt: number;
  upperFt: number;
  /** F)/G) som tekst, om de finnes. */
  lowerText?: string;
  upperText?: string;
  from: Date | null;
  to: Date | null;
  est: boolean;
  perm: boolean;
  schedule?: string;
  text: string;
  /** Senter og radius fra Q-linjen. */
  qLat?: number;
  qLon?: number;
  qRadiusNm?: number;
  geoms: NotamGeom[];
  raw: string;
}

/** Hva slags NOTAM, for farge og symbol. */
export type NotamKind = 'restriction' | 'obstacle' | 'aerodrome' | 'navaid' | 'airspace' | 'other';

export function notamKind(n: Notam): NotamKind {
  const c = n.code.slice(1, 3);
  if (/^R/.test(c)) return 'restriction';
  if (/^O[BL]/.test(c)) return 'obstacle';
  if (/^[MFL]/.test(c) || /^ (A)$/.test(n.scope)) return 'aerodrome';
  if (/^N/.test(c) || /^I/.test(c)) return 'navaid';
  if (/^A/.test(c) || /^W/.test(c)) return 'airspace';
  return 'other';
}

const fieldRe = /(?:^|\s)([QABCDEFG])\)\s*/g;

function fields(msg: string): Record<string, string> {
  const out: Record<string, string> = {};
  const hits = [...msg.matchAll(fieldRe)];
  hits.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : msg.length;
    // E) kan selv inneholde «A)»-lignende tekst; behold første forekomst av hvert felt unntatt E.
    if (out[m[1]] === undefined) out[m[1]] = msg.slice(start, end).trim();
    else if (m[1] !== 'E' && out.E !== undefined && !('F' in out)) out.E += ` ${m[1]}) ${msg.slice(start, end).trim()}`;
  });
  return out;
}

export function parseNotamTime(s: string | undefined): Date | null {
  const m = s?.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

/** «593512N 0104523E», «5935N01045E», «593512.50N0104523.20E». */
const COORD = /(\d{2})(\d{2})(\d{2}(?:[.,]\d+)?)?([NS])\s*(\d{3})(\d{2})(\d{2}(?:[.,]\d+)?)?([EW])/g;

function coordOf(m: RegExpMatchArray): [number, number] {
  const lat = (+m[1] + +m[2] / 60 + +(m[3] ?? '0').replace(',', '.') / 3600) * (m[4] === 'S' ? -1 : 1);
  const lon = (+m[5] + +m[6] / 60 + +(m[7] ?? '0').replace(',', '.') / 3600) * (m[8] === 'W' ? -1 : 1);
  return [lat, lon];
}

/** Finn områder i fritekst: koordinatrekker (polygoner), sirkler med radius og enkeltpunkter. */
export function geometryFromText(text: string): NotamGeom[] {
  const t = text.replace(/\s+/g, ' ').toUpperCase();
  const hits = [...t.matchAll(COORD)];
  const groups: { pts: [number, number][]; start: number; end: number }[] = [];
  for (const m of hits) {
    const g = groups[groups.length - 1];
    const gap = g ? t.slice(g.end, m.index) : '';
    // Samme rekke når det bare står skilletegn (og evt. «TO»/«THEN ALONG») mellom.
    if (g && /^[\s,\-–/]*(?:(?:TO|THEN|AND|ALONG|-)[\s,\-–/]*)*$/.test(gap)) {
      g.pts.push(coordOf(m));
      g.end = m.index! + m[0].length;
    } else groups.push({ pts: [coordOf(m)], start: m.index!, end: m.index! + m[0].length });
  }
  const out: NotamGeom[] = [];
  groups.forEach((g, gi) => {
    const pts = g.pts;
    if (pts.length >= 3) {
      // Lukket polygon: fjern gjentatt startpunkt.
      const [a, z] = [pts[0], pts[pts.length - 1]];
      if (pts.length > 3 && Math.abs(a[0] - z[0]) < 1e-6 && Math.abs(a[1] - z[1]) < 1e-6) pts.pop();
      out.push({ type: 'polygon', pts });
      return;
    }
    // Radius like før eller etter koordinaten i samme setning: «RADIUS 2NM CENTRED ON …», «… RADIUS 500M».
    const prevEnd = gi > 0 ? groups[gi - 1].end : 0;
    const nextStart = gi + 1 < groups.length ? groups[gi + 1].start : t.length;
    const before = t.slice(Math.max(prevEnd, g.start - 60), g.start).split(/\.\s/).pop()!;
    const after = t.slice(g.end, Math.min(nextStart, g.end + 30)).split(/\.\s/)[0];
    const r = `${before} ${after}`.match(/RADIUS(?: OF)? ?(\d+(?:[.,]\d+)?) ?(NM|KM|M)\b/);
    for (const p of pts) {
      if (r) {
        const v = +r[1].replace(',', '.');
        const nm = r[2] === 'NM' ? v : r[2] === 'KM' ? v / 1.852 : v / 1852;
        out.push({ type: 'circle', lat: p[0], lon: p[1], rNm: nm });
      } else out.push({ type: 'point', lat: p[0], lon: p[1] });
    }
  });
  return out;
}

function heightFt(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.toUpperCase();
  if (/\b(SFC|GND)\b/.test(t)) return 0;
  if (/\bUNL\b/.test(t)) return 99999;
  const fl = t.match(/FL ?(\d{2,3})/);
  if (fl) return +fl[1] * 100;
  const ft = t.match(/(\d+) ?FT/);
  if (ft) return +ft[1];
  const m = t.match(/(\d+) ?M\b/);
  if (m) return Math.round(+m[1] * 3.2808);
  return null;
}

export function parseNotam(r: RawNotam): Notam | null {
  const msg = r.msg.replace(/\r/g, '');
  const f = fields(msg);
  if (!f.Q) return null;
  const id = msg.match(/^[A-Z]\d{4}\/\d{2}/)?.[0] ?? '';
  const q = f.Q.split('/').map((s) => s.trim());
  const [fir = '', code = '', , , scope = '', lo = '000', up = '999', pos = ''] = q;
  const qm = pos.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?/);
  const qLat = qm ? (+qm[1] + +qm[2] / 60) * (qm[3] === 'S' ? -1 : 1) : undefined;
  const qLon = qm ? (+qm[4] + +qm[5] / 60) * (qm[6] === 'W' ? -1 : 1) : undefined;
  const qRadiusNm = qm?.[7] ? +qm[7] : undefined;
  const c = f.C ?? '';
  const text = (f.E ?? '').trim();
  const lowerQ = +lo * 100;
  const upperQ = +up * 100;
  return {
    id,
    locs: (f.A ?? r.loc).split(/\s+/).filter(Boolean),
    fir,
    code,
    scope,
    lowerFt: heightFt(f.F) ?? lowerQ,
    upperFt: heightFt(f.G) ?? upperQ,
    lowerText: f.F,
    upperText: f.G,
    from: parseNotamTime(f.B),
    to: /PERM/.test(c) ? null : parseNotamTime(c),
    est: /EST/.test(c),
    perm: /PERM/.test(c),
    schedule: f.D,
    text,
    qLat,
    qLon,
    qRadiusNm,
    geoms: geometryFromText(text),
    raw: msg,
  };
}

/** Gjelder nå, eller starter innen `aheadH` timer. */
export function notamStatus(n: Notam, now = new Date(), aheadH = 24): 'active' | 'upcoming' | 'expired' | 'later' {
  if (n.to && n.to.getTime() < now.getTime()) return 'expired';
  if (!n.from || n.from.getTime() <= now.getTime()) return 'active';
  return n.from.getTime() - now.getTime() <= aheadH * 3600e3 ? 'upcoming' : 'later';
}

/** Geometri som skal tegnes: fra teksten, ellers Q-linjens sirkel (når den er lokal nok). */
export function notamShapes(n: Notam): NotamGeom[] {
  if (n.geoms.length) return n.geoms;
  if (n.qLat !== undefined && n.qLon !== undefined && n.qRadiusNm !== undefined && n.qRadiusNm < 100)
    return [{ type: 'circle', lat: n.qLat, lon: n.qLon, rNm: Math.max(n.qRadiusNm, 0.5) }];
  return [];
}

export function fmtNotamTime(d: Date | null): string {
  if (!d) return '–';
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
}

export const NOTAM_URL = 'https://raw.githubusercontent.com/oer010/landing/notam-data/notam.json';

export interface NotamData {
  generated: string;
  source: string;
  notams: Notam[];
}

let cache: { at: number; p: Promise<NotamData | null> } | null = null;

/** Henter NOTAM (maks hvert 10. minutt). Faller tilbake på sist lagrede kopi uten nett. */
export function loadNotams(force = false): Promise<NotamData | null> {
  if (!force && cache && Date.now() - cache.at < 10 * 60e3) return cache.p;
  const p = fetch(`${NOTAM_URL}?t=${Math.floor(Date.now() / 300e3)}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((txt) => {
      try {
        localStorage.setItem('vfrapp.notamCache', txt);
      } catch {
        /* full lagring */
      }
      return txt;
    })
    .catch(() => localStorage.getItem('vfrapp.notamCache'))
    .then((txt) => {
      if (!txt) return null;
      const d = JSON.parse(txt) as { generated: string; source: string; notams: RawNotam[] };
      return { generated: d.generated, source: d.source, notams: d.notams.map(parseNotam).filter((n): n is Notam => !!n) };
    })
    .catch(() => null);
  cache = { at: Date.now(), p };
  return p;
}
