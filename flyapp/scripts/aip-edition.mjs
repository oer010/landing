// Skriver gjeldende AIP Norge-utgave (f.eks. 2026-09-03) og utgaven appen er bygget med.
// Brukes av .github/workflows/aip.yml for å avgjøre om dataene må hentes på nytt.
// Utdata (GitHub Actions-format): current=…, built=…, changed=true|false
import { readFile } from 'node:fs/promises';

const r = await fetch('https://aim-prod.avinor.no/no/AIP');
if (!r.ok) throw new Error(`AIP: HTTP ${r.status}`);
const current = (await r.text()).match(/(\d{4}-\d{2}-\d{2})-AIRAC\/html\/index/)?.[1];
if (!current) throw new Error('fant ikke gjeldende AIP-utgave');
let built = '';
try {
  built = JSON.parse(await readFile(new URL('../../vfr/data/aip-freq.json', import.meta.url), 'utf8')).edition ?? '';
} catch {
  /* ingen publisert data */
}
// Luftrom kommer fra relet/pg-xc og oppdateres ofte noen dager etter AIRAC – sjekk den også.
let asBuilt = '';
let asSource = '';
try {
  asBuilt = JSON.parse(await readFile(new URL('../../vfr/data/airspace.json', import.meta.url), 'utf8')).airac ?? '';
  const gj = await (await fetch(process.env.FLYAPP_AIRSPACE_URL || 'https://raw.githubusercontent.com/relet/pg-xc/master/geojson/luftrom.geojson')).json();
  for (const f of gj.features ?? []) {
    const m = String(f.properties?.source_href ?? '').match(/(\d{4}-\d{2}-\d{2})-AIRAC/);
    if (m && m[1] > asSource) asSource = m[1];
  }
} catch {
  /* luftromskilden nede: ikke grunn til å bygge på nytt */
}
console.log(`current=${current}`);
console.log(`built=${built}`);
console.log(`changed=${current !== built}`);
console.log(`airspace_built=${asBuilt}`);
console.log(`airspace_source=${asSource}`);
console.log(`airspace_changed=${!!asSource && asSource > asBuilt}`);
