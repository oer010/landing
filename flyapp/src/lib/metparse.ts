// Tolker rå METAR-tekst (ICAO-format) til samme struktur som AWC-JSON,
// slik at METAR fra Meteorologisk institutt kan brukes likt.

import type { CloudLayer, Metar } from './metar';

/** Tidspunkt fra DDHHMMZ, plassert i riktig måned rundt `now`. */
export function obsTimeFromGroup(group: string, now = new Date()): number | null {
  const m = group.match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const [d, hh, mm] = [+m[1], +m[2], +m[3]];
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, hh, mm);
  // Dag i fremtiden (> 1 døgn) betyr forrige måned.
  if (t - now.getTime() > 86400000) t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, d, hh, mm);
  return Math.round(t / 1000);
}

export function parseMetar(raw: string, now = new Date()): Metar | null {
  const text = raw.replace(/=\s*$/, '').trim();
  const tokens = text.split(/\s+/);
  let i = 0;
  if (tokens[i] === 'METAR' || tokens[i] === 'SPECI') i++;
  const icaoId = tokens[i++];
  if (!icaoId || !/^[A-Z]{4}$/.test(icaoId)) return null;
  const obs = obsTimeFromGroup(tokens[i] ?? '', now);
  if (obs === null) return null;
  i++;

  const m: Metar & { visM?: number } = {
    icaoId,
    obsTime: obs,
    rawOb: text,
    temp: null,
    dewp: null,
    wdir: null,
    wspd: null,
    wgst: null,
    visib: null,
    altim: null,
    clouds: [],
    lat: 0,
    lon: 0,
    name: '',
  };

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'RMK' || t === 'NOSIG' || t === 'TEMPO' || t === 'BECMG') break;
    let r: RegExpMatchArray | null;
    if ((r = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
      const f = r[4] === 'MPS' ? 1.943844 : 1;
      m.wdir = r[1] === 'VRB' ? 'VRB' : +r[1];
      m.wspd = Math.round(+r[2] * f);
      m.wgst = r[3] ? Math.round(+r[3] * f) : null;
    } else if (t === 'CAVOK') {
      m.cover = 'CAVOK';
      m.visib = '6+';
      m.visM = 10000;
    } else if ((r = t.match(/^(\d{4})(NDV)?$/)) && m.visib === null) {
      const meters = +r[1];
      m.visM = meters;
      m.visib = meters >= 9999 ? '6+' : Math.round((meters / 1609.344) * 100) / 100;
    } else if ((r = t.match(/^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/))) {
      m.clouds.push({ cover: r[1], base: r[2] === '///' ? null : +r[2] * 100 } as CloudLayer);
    } else if ((r = t.match(/^VV(\d{3}|\/\/\/)$/))) {
      m.clouds.push({ cover: 'VV', base: r[1] === '///' ? 0 : +r[1] * 100 });
    } else if (/^(NSC|NCD|SKC|CLR)$/.test(t)) {
      m.cover = m.cover ?? t;
    } else if ((r = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) {
      const n = (s: string) => (s.startsWith('M') ? -+s.slice(1) : +s);
      m.temp = n(r[1]);
      m.dewp = r[2] ? n(r[2]) : null;
    } else if ((r = t.match(/^Q(\d{4})$/))) {
      m.altim = +r[1];
    } else if ((r = t.match(/^A(\d{4})$/))) {
      m.altim = Math.round((+r[1] / 100) * 33.8639);
    }
  }
  return m;
}

/** Siste melding per stasjon fra MET sin tekstliste (eldste først). */
export function latestByStation(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const id = l.replace(/^(METAR|SPECI|TAF)\s+(AMD\s+|COR\s+)?/, '').slice(0, 4);
    if (/^[A-Z]{4}$/.test(id)) out.set(id, l.replace(/=\s*$/, ''));
  }
  return out;
}
