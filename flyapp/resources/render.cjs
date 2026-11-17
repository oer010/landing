// Lager iOS app-ikon (1024×1024, uten gjennomsiktighet) og oppstartsbilde (2732×2732).
// Kjør: node resources/render.cjs   (krever Playwright/Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, 'icon-ios.svg'), 'utf8');
const assets = path.join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.setContent(`<style>body{margin:0}svg{width:1024px;height:1024px;display:block}</style>${svg}`);
  await p.screenshot({ path: path.join(assets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), omitBackground: false });
  await p.setViewportSize({ width: 2732, height: 2732 });
  await p.setContent(`<style>body{margin:0;width:2732px;height:2732px;background:#0b1220;display:grid;place-items:center;font-family:sans-serif}svg{width:520px;height:520px}</style>${svg.replace('<rect width="512" height="512" fill="#0b1220"/>', '')}`);
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
    await p.screenshot({ path: path.join(assets, 'Splash.imageset', f) });
  await b.close();
  console.log('Ikon og splash skrevet');
})();
