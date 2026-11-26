// Før publisering: hvis de publiserte dataene (../vfr/data) er nyere enn de lokale
// (public/data) – f.eks. fordi AIP-jobben har hentet ny AIP – kopieres de inn først,
// så en lokal bygging aldri erstatter nyere data med eldre.
import { copyFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const pub = new URL('../../vfr/data/', import.meta.url);
const loc = new URL('../public/data/', import.meta.url);
if (!existsSync(pub)) process.exit(0);
const stamp = async (u) => {
  try {
    const d = JSON.parse(await readFile(u, 'utf8'));
    return `${d.edition ?? d.airac ?? ''}|${d.generated ?? ''}`;
  } catch {
    return '';
  }
};
for (const f of await readdir(pub)) {
  if (!f.endsWith('.json')) continue;
  const a = await stamp(new URL(f, pub));
  const b = await stamp(new URL(f, loc));
  if (a > b) {
    await copyFile(new URL(f, pub), new URL(f, loc));
    console.log(`Hentet nyere publisert ${f} (${a.split('|')[0] || a})`);
  }
}
