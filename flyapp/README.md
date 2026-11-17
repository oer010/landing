# VFR Flyapp

En nettleserbasert flyapp i stil med ForeFlight og Garmin Pilot, avgrenset til **VFR-flyging**.
Den kjører på mobil, nettbrett og PC og kan installeres som app (PWA) med offline-støtte.

> ⚠️ Kun for planlegging og situasjonsforståelse. **Ikke godkjent for navigasjon.**
> Bruk alltid gjeldende AIP, VFR-kart, NOTAM og offisiell værbriefing.

## Funksjoner

| Område | Innhold |
| --- | --- |
| **Kart** | Topografisk/OSM-bakgrunn, flyplasser (blå = TWR, magenta = ukontrollert), VOR/NDB, METAR-farger (VFR/MVFR/IFR/LIFR), luftrom fra openAIP (valgfri nøkkel), rullebaner ved høy zoom, NM-skala |
| **Moving map** | GPS-posisjon, flysymbol, fartsvektor, sporlinje, «følg fly», datastripe (GS, TRK, ALT, neste, DIS, BRG, ETE, ETA, XTK, gjenstående) |
| **Rute** | Skriv rute som tekst (`ENKJ GRM 6030N00930E ENBR`), rediger på kartet, gummistrikk-innsetting, dra og snap til flyplass/navaid, snu, lagre ruter, Direkte-til |
| **Navlogg** | TC, misvisning (WMM2025), MC, vindkorreksjon, MH, distanse, GS, ETE, drivstoff, kumulativ tid; utskrift |
| **VFR-sjekk** | Halvsirkelregelen (SERA), drivstoff mot reserve, mørke/sivil skumring, METAR-kategori for flyplassene i ruten |
| **Flyplasser** | Søk (ident, IATA, navn, sted), nærmeste, rullebaner, frekvenser, sol/skumring, METAR/TAF, mot/sidevind per bane |
| **Vær** | METAR/TAF for rute og favoritter, dekoding på norsk, lenker til IPPC/yr/Windy |
| **Fly, M&B** | Flere flyprofiler, stasjoner, drivstoff i volum, avgangs- og landings-CG, envelope-diagram |
| **E6B** | Vindtrekant, sidevind, trykk-/tetthetshøyde, TAS, tid/fart/distanse, skybase, omregninger, sol |
| **Logg** | GPS-sporlogging (GPX-eksport), loggbok med 90-dagers landingskontroll og CSV-eksport |
| **Sjekklister** | Redigerbare sjekklister med standard VFR-lister |
| **Eksport** | GPX, Garmin `.fpl`, utkast til ICAO-flightplan (FPL) |
| **Simulator** | «Fly» ruten ×1/×8/×32 for å øve og teste |

All brukerdata lagres lokalt i nettleseren, og appen har ingen konto og ingen server-database.

## Kom i gang

```bash
cd flyapp
npm ci
npm run data     # laster ned flyplass- og navaid-data (OurAirports) til public/data/
npm run dev      # http://localhost:5173
```

Andre kommandoer: `npm test` (enhetstester), `npm run typecheck`, `npm run build`, `npm run preview`.

### Dataregion

`npm run data` henter hele Europa som standard (ca. 7 500 flyplasser, 1,2 MB). Med
`FLYAPP_COUNTRIES` kan du velge land eller hele verden:

```bash
FLYAPP_COUNTRIES=NO,SE,DK,FI npm run data
FLYAPP_COUNTRIES=ALL npm run data
```

### Vær og CORS

aviationweather.gov sender ikke CORS-headere, så nettleseren henter METAR/TAF via `/awc/*`.
Vite-serveren (`dev` og `preview`) videresender dette automatisk. Ved statisk hosting må
webserveren gjøre det samme, for eksempel i nginx:

```nginx
location /awc/ { proxy_pass https://aviationweather.gov/; proxy_set_header Host aviationweather.gov; }
```

### Luftrom (valgfritt)

Under **Mer → Luftrom fra openAIP** kan du lime inn en gratis API-nøkkel fra
[openaip.net](https://www.openaip.net/). Nøkkelen lagres bare i nettleseren.

## Datakilder og lisenser

- Flyplasser, rullebaner, frekvenser og navaids: [OurAirports](https://ourairports.com/data/) (public domain)
- Kart: © OpenStreetMap-bidragsytere, OpenTopoMap (CC-BY-SA)
- Vær: [aviationweather.gov Data API](https://aviationweather.gov/data/api/)
- Luftrom: [openAIP](https://www.openaip.net/) (CC BY-NC 4.0)
- Misvisning: NOAA World Magnetic Model 2025 (via `geomagnetism`)

## Struktur

```
scripts/build-data.mjs   nedlasting og komprimering av OurAirports-data
src/lib/                 ren logikk med tester: geodesi, navlogg, E6B, M&B, sol, METAR, eksport
src/ui/                  kart (Leaflet), posisjon/GPS/simulator, datastripe, paneler
public/sw.js             service worker for offline app og kartfliser
```
