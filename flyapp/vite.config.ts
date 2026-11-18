import { Agent, type AgentOptions } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Legger alle byggede filer (JS/CSS) inn i service workerens forhåndslagring,
// så appen starter uten nett allerede etter første besøk.
const precacheAssets = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'precache-assets',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).map((f) => `./${f}`);
      const sw = join(outDir, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('self.__ASSETS = [];', `self.__ASSETS = ${JSON.stringify(files)};`));
    },
  };
};

// aviationweather.gov sender ikke CORS-headere, så nettleseren kan ikke hente
// METAR/TAF direkte. Dev- og preview-serveren videresender derfor /awc/* dit.
// Ved statisk hosting må tilsvarende proxy settes opp på webserveren.
//
// proxyEnv gjør at HTTPS_PROXY/NO_PROXY respekteres (Node >= 22.21); uten
// slike variabler går forespørselen direkte som vanlig.
const agent = new Agent({ keepAlive: true, proxyEnv: process.env } as AgentOptions & { proxyEnv: NodeJS.ProcessEnv });

const awcProxy = {
  '/awc': {
    target: 'https://aviationweather.gov',
    changeOrigin: true,
    agent,
    rewrite: (p: string) => p.replace(/^\/awc/, ''),
  },
};

export default defineConfig({
  base: './',
  plugins: [precacheAssets()],
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  server: { host: true, proxy: awcProxy },
  preview: { host: true, proxy: awcProxy },
});
