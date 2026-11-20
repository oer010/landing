// Service worker: appen og flyplassdata virker offline, og kartfliser du har
// sett, caches slik at de også er tilgjengelige uten dekning i lufta.
const APP_CACHE = 'vfr-app-v28';
const TILE_CACHE = 'vfr-tiles-v1';
const OFFLINE_CACHE = 'vfr-offline-v1';
const MAX_TILES = 6000;
// Fylles inn ved bygging (vite.config.ts): alle JS/CSS-filer i appen.
self.__ASSETS = [];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(APP_CACHE)
      .then((c) => c.addAll([...self.__ASSETS, './', './index.html', './data/airports.json', './data/airspace.json', './data/aip-freq.json', './data/vfr.json', './data/fir.json', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, TILE_CACHE, OFFLINE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isTile = (url) => /tile\.(openstreetmap|opentopomap)\.org|tiles\.openaip\.net|cache\.kartverket\.no/.test(url.hostname);

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Vær: alltid nett først, aldri gammel cache uten å si fra (appen viser alder).
  if (url.pathname.includes('/awc/')) return;

  if (isTile(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        // Nedlastede kart først (lagret med vanlig URL), så nylig viste fliser.
        const hit = (await (await caches.open(OFFLINE_CACHE)).match(url.href)) ?? (await cache.match(e.request));
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') {
          cache.put(e.request, res.clone());
          if (Math.random() < 0.02) trimTiles();
        }
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Nett først for app-filer, og alltid spør serveren om nyere versjon
    // (no-cache = revalider, så nettleserens 10-min-cache ikke gir gammel app).
    e.respondWith(
      fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(url.href, { ignoreSearch: true, ignoreVary: true })
            .then((r) => r ?? (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
        ),
    );
  }
});
