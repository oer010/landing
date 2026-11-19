// MET Norge (api.met.no, åpne data med CORS): radarbilder, områdevarsel (IGA, tidligere LLF)
// og SIGMET/AIRMET med områder som kan tegnes i kartet.

const API = 'https://api.met.no/weatherapi';

export const RADAR_AREAS: Record<string, string> = {
  norway: 'Hele Norge',
  southeastern_norway: 'Østlandet',
  southwestern_norway: 'Sørvestlandet',
  western_norway: 'Vestlandet',
  central_norway: 'Trøndelag',
  northwestern_norway: 'Nordvestlandet',
  southern_nordland: 'Helgeland',
  northern_nordland: 'Nordland nord',
  troms: 'Troms',
  finnmark: 'Finnmark',
};

export interface RadarFrame {
  time: string;
  url: string;
}

/** Radarbilder (reflektivitet) for området, eldste først (siste ~3 timer). */
export async function radarFrames(area: string, fetcher: typeof fetch = fetch): Promise<RadarFrame[]> {
  const r = await fetcher(`${API}/radar/2.0/available.json?area=${area}&type=reflectivity&content=image`);
  if (!r.ok) throw new Error(`Radar: HTTP ${r.status}`);
  const list = (await r.json()) as { params: { time: string }; uri: string }[];
  return list.map((x) => ({ time: x.params.time, url: x.uri })).sort((a, b) => a.time.localeCompare(b.time));
}

export interface AreaForecast {
  header: string;
  issued: string;
  title: string;
  text: string;
}

/** Områdevarsler (IGA) for Polaris FIR. */
export async function areaForecasts(fetcher: typeof fetch = fetch): Promise<AreaForecast[]> {
  const r = await fetcher(`${API}/aviationforecast/2.0/available.json`);
  if (!r.ok) throw new Error(`Områdevarsel: HTTP ${r.status}`);
  const list = ((await r.json()) as { params: { wmoheader?: string }; uri: string }[]).filter((x) => x.params.wmoheader);
  const out = await Promise.all(
    list.map(async (x) => {
      const t = await (await fetcher(x.uri)).text();
      return parseIga(x.params.wmoheader!, t);
    }),
  );
  return out.sort((a, b) => a.header.localeCompare(b.header));
}

export function parseIga(header: string, raw: string): AreaForecast {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim() && l.trim() !== 'ZCZC' && l.trim() !== 'NNNN');
  const head = lines.find((l) => l.startsWith(header)) ?? '';
  const titleLine = lines.find((l) => /^IGA/.test(l)) ?? '';
  const body = lines.filter((l) => l !== head && l !== titleLine).join('\n');
  return { header, issued: head.split(/\s+/)[2] ?? '', title: titleLine.replace(/^IGA PROG\s*/, '').trim(), text: body.trim() };
}

export interface MetWarning {
  kind: 'SIGMET' | 'AIRMET' | 'WS WRNG' | 'OTHER';
  /** F.eks. «I06». */
  id: string;
  fir: string;
  from: Date | null;
  to: Date | null;
  text: string;
  polygons: [number, number][][];
  lowerFt: number | null;
  upperFt: number | null;
  cancelled: boolean;
  /** Fenomen, f.eks. «MOD ICE», «SEV TURB», «EMBD TS». */
  phenomenon: string;
  /** Hele FIR-en, eventuelt avgrenset av halvplan («N OF N6800»). */
  firArea: { entire: boolean; cuts: { dir: 'N' | 'S' | 'E' | 'W'; val: number }[] } | null;
}

function ddhhmm(s: string | undefined, now: Date): Date | null {
  const m = s?.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +m[1], +m[2], +m[3]));
  // Månedsskifte: dag langt frem/tilbake i tid.
  if (d.getTime() - now.getTime() > 15 * 864e5) d.setUTCMonth(d.getUTCMonth() - 1);
  if (now.getTime() - d.getTime() > 15 * 864e5) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

const lim = (s: string): number | null => {
  if (/SFC|GND/.test(s)) return 0;
  const fl = s.match(/FL(\d{3})/);
  if (fl) return +fl[1] * 100;
  const ft = s.match(/(\d{3,5})FT/);
  return ft ? +ft[1] : null;
};

/** Tolker MET sin SIGMET/AIRMET-tekst (flere meldinger skilt med ZCZC). */
export function parseWarnings(raw: string, now = new Date()): MetWarning[] {
  const out: MetWarning[] = [];
  for (const block of raw.replace(/\r/g, '').split('ZCZC')) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const text = lines.slice(1).join(' ').replace(/\s*=\s*$/, '');
    const m = text.match(/^(\S+)\s+(SIGMET|AIRMET|WS WRNG)\s+(\S+)\s+(?:\d{6}\s+)?VALID\s+(\d{6})\/(\d{6})/);
    const kind = (m?.[2] as MetWarning['kind']) ?? 'OTHER';
    const polygons: [number, number][][] = [];
    for (const wi of text.matchAll(/WI ((?:[NS]\d{4,6}\s+[EW]\d{5,7}\s*-?\s*)+)/g)) {
      const pts = [...wi[1].matchAll(/([NS])(\d{2})(\d{2})(\d{2})?\s+([EW])(\d{3})(\d{2})(\d{2})?/g)].map((c) => {
        const lat = (+c[2] + +c[3] / 60 + +(c[4] ?? 0) / 3600) * (c[1] === 'S' ? -1 : 1);
        const lon = (+c[6] + +c[7] / 60 + +(c[8] ?? 0) / 3600) * (c[5] === 'W' ? -1 : 1);
        return [lat, lon] as [number, number];
      });
      if (pts.length >= 3) polygons.push(pts);
    }
    const lv = text.match(/\s((?:SFC|GND|\d{3,5}FT|FL\d{3}))\/((?:\d{3,5}FT|FL\d{3}))\b/) ?? text.match(/\b(?:TOP|ABV)\s+(FL\d{3})/);
    out.push({
      kind,
      id: m?.[3] ?? '',
      fir: m?.[1] ?? '',
      from: ddhhmm(m?.[4], now),
      to: ddhhmm(m?.[5], now),
      text,
      polygons,
      lowerFt: lv && lv.length > 2 ? lim(lv[1]) : null,
      upperFt: lv ? lim(lv[lv.length > 2 ? 2 : 1]) : null,
      cancelled: /\bCNL\b/.test(text),
      phenomenon: phenomenonOf(text),
      firArea: polygons.length ? null : firAreaOf(text),
    });
  }
  return out;
}

const PHEN = /\b((?:ISOL |OCNL |FRQ |EMBD |OBSC |SQL )?(?:TSGR|TS)|(?:SEV |MOD )(?:ICE|TURB|MTW)(?: \(FZRA\))?|RDOACT CLD|VA CLD|HVY (?:DS|SS)|SFC (?:VIS|WIND)|(?:BKN|OVC) CLD|MT OBSC|ISOL CB|OCNL CB|FRQ CB)\b/;

export function phenomenonOf(text: string): string {
  return text.match(PHEN)?.[1] ?? '';
}

/** «ENTIRE FIR», «N OF N6800», «S OF N6100 AND E OF E01200» → område som del av FIR-en. */
export function firAreaOf(text: string): MetWarning['firArea'] {
  const cuts: { dir: 'N' | 'S' | 'E' | 'W'; val: number }[] = [];
  for (const m of text.matchAll(/\b([NSEW]) OF ([NS])(\d{2})(\d{2})?\b(?! [EW]\d)|\b([EW]) OF ([EW])(\d{3})(\d{2})?\b/g)) {
    if (m[1]) cuts.push({ dir: m[1] as 'N' | 'S', val: (+m[3] + +(m[4] ?? 0) / 60) * (m[2] === 'S' ? -1 : 1) });
    else cuts.push({ dir: m[5] as 'E' | 'W', val: (+m[7] + +(m[8] ?? 0) / 60) * (m[6] === 'W' ? -1 : 1) });
  }
  const entire = /\bENTIRE FIR\b/.test(text);
  return entire || cuts.length ? { entire, cuts } : null;
}

/** Klipp et polygon ([lat, lon]) med halvplan (Sutherland–Hodgman). */
export function clipPolygon(poly: [number, number][], cut: { dir: 'N' | 'S' | 'E' | 'W'; val: number }): [number, number][] {
  const idx = cut.dir === 'N' || cut.dir === 'S' ? 0 : 1;
  const keep = (p: [number, number]) => (cut.dir === 'N' || cut.dir === 'E' ? p[idx] >= cut.val : p[idx] <= cut.val);
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ka = keep(a);
    const kb = keep(b);
    if (ka) out.push(a);
    if (ka !== kb) {
      const t = (cut.val - a[idx]) / (b[idx] - a[idx]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Områdene en melding dekker: egne polygoner, eller FIR-en (eventuelt klippet). */
export function warningAreas(w: MetWarning, fir: [number, number][][]): [number, number][][] {
  if (w.polygons.length) return w.polygons;
  if (!w.firArea || !fir.length) return [];
  return fir.map((p) => w.firArea!.cuts.reduce((acc, c) => (acc.length ? clipPolygon(acc, c) : acc), p)).filter((p) => p.length >= 3);
}

export async function fetchWarnings(fetcher: typeof fetch = fetch): Promise<MetWarning[]> {
  const r = await fetcher(`${API}/sigmets/2.0/`);
  if (!r.ok) throw new Error(`SIGMET: HTTP ${r.status}`);
  return parseWarnings(await r.text());
}

/** Gjeldende (ikke utløpt, ikke kansellert). Kansellerte meldinger fjerner også den de kansellerer. */
export function activeWarnings(list: MetWarning[], now = new Date()): MetWarning[] {
  const cancelledIds = new Set(list.filter((w) => w.cancelled).map((w) => (w.text.match(/CNL (?:SIGMET|AIRMET) (\S+)/)?.[1] ?? '')));
  return list.filter((w) => !w.cancelled && !cancelledIds.has(w.id) && (!w.to || w.to.getTime() > now.getTime()));
}
