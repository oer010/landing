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
console.log(`current=${current}`);
console.log(`built=${built}`);
console.log(`changed=${current !== built}`);
