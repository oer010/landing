# VFR Flyapp

En iPhone-app (iOS, via Capacitor) i stil med ForeFlight og Garmin Pilot, avgrenset til **VFR-flyging**.
Samme kode kjører også i nettleser (PWA) på iPad, Android og PC.

> ⚠️ Kun for planlegging og situasjonsforståelse. **Ikke godkjent for navigasjon.**
> Bruk alltid gjeldende AIP, VFR-kart, NOTAM og offisiell værbriefing.

## Funksjoner

| Område | Innhold |
| --- | --- |
| **Kart** | Topografisk/OSM-bakgrunn, flyplasser (blå = TWR, magenta = ukontrollert), VOR/NDB, METAR-farger (VFR/MVFR/IFR/LIFR), norsk luftrom med høydegrenser, rullebaner ved høy zoom, NM-skala |
| **Moving map** | GPS-posisjon, flysymbol, fartsvektor, sporlinje, «følg fly», datastripe (GS, TRK, ALT, neste, DIS, BRG, ETE, ETA, XTK, gjenstående) |
| **Rute** | Fra/Til med søk, dobbelttrykk/trykk på rutestreken for nye punkter som kan dras, automatisk stedsnavn (Kartverket) eller eget navn; skriv rute som tekst (`ENKJ GRM 6030N00930E ENBR`), rediger på kartet, gummistrikk-innsetting, dra og snap til flyplass/navaid, snu, lagre ruter, Direkte-til |
| **Navlogg** | Klatring (TOC), marsj og nedstigning (TOD) med egen fart/stige-/synkehastighet/forbruk; høyde per legg; prognosevind per legg i leggets høyde; TC, misvisning (WMM2025), MC, WCA, MH, distanse, GS, ETE, drivstoff; utskrift |
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

## iPhone-app (iOS)

Appen pakkes som en ekte iOS-app med [Capacitor](https://capacitorjs.com/). Xcode-prosjektet ligger i `ios/`.
På iPhone bruker den native GPS (med tillatelsesdialog), holder skjermen våken under flyging,
henter vær direkte fra aviationweather.gov og deler GPX/.fpl/navlogg via iOS-delingsarket
(Filer, AirDrop, Garmin Pilot …). Langt trykk på kartet gir punktmeny.

**Krever en Mac med Xcode 16 eller nyere** (iOS-apper kan ikke bygges på Linux/Windows).

```bash
cd flyapp
npm ci
npm run data      # flyplassdata (pakkes inn i appen og virker offline)
npm run ios       # bygger webdelen, synkroniserer til ios/ og åpner Xcode
```

I Xcode:

1. Velg **App**-targetet → *Signing & Capabilities* → velg ditt Team (Apple-ID).
   Bytt gjerne *Bundle Identifier* (`no.vfrflyapp.app`) til noe du eier.
2. Koble til iPhonen, velg den som mål og trykk ▶. Første gang må du godta utvikleren på
   telefonen: *Innstillinger → Generelt → VPN og enhetsadministrasjon*.
3. For TestFlight/App Store: *Product → Archive* → *Distribute App*. Krever betalt
   Apple Developer-medlemskap.

Med gratis Apple-ID kan appen kjøres på din egen telefon, men den må installeres på nytt hver 7. dag.
Etter endringer i koden: `npm run ios:sync` (eller `npm run ios`).

Ikon og oppstartsbilde lages fra `resources/icon-ios.svg` med `node resources/render.cjs`.

## Kom i gang (nettleser)

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

### Luftrom

`npm run data` henter norsk luftrom (CTR, TMA/CTA, TIZ/TIA, RMZ/TMZ, restriksjons- og
fareområder) og legger det i `public/data/airspace.json`. Trykk på kartet for å se
luftrommene over et punkt; rutesjekken lister luftrom langs ruten i marsjhøyden.
AIRAC-datoen vises i appen, med advarsel når dataene er eldre enn én syklus (28 dager).

## Datakilder og lisenser

- Frekvenser for norske flyplasser i AIP: [AIP Norge](https://aim-prod.avinor.no/no/AIP) AD 2.18, hentet av `npm run data` (gjeldende utgave)
- Flyplasser, rullebaner, navaids og frekvenser utenfor AIP Norge: [OurAirports](https://ourairports.com/data/) (public domain, brukerbidrag – kan være utdatert)
- Kart: © OpenStreetMap-bidragsytere, OpenTopoMap (CC-BY-SA)
- Vær: [aviationweather.gov Data API](https://aviationweather.gov/data/api/)
- Luftrom: AIP Norge, konvertert av [luftrom.info / relet/pg-xc](https://github.com/relet/pg-xc) (uten ansvar – sjekk gjeldende AIP og NOTAM). Hentes av `npm run data`.
- Stedsnavn for rutepunkter: [Kartverket stedsnavn-API](https://ws.geonorge.no/stedsnavn/v1/)
- Vind i høyden: [Open-Meteo](https://open-meteo.com/). METAR/TAF uten proxy: [MET Norge](https://api.met.no/)
- Misvisning: NOAA World Magnetic Model 2025 (via `geomagnetism`)

## Struktur

```
scripts/build-data.mjs   nedlasting og komprimering av OurAirports-data
src/lib/                 ren logikk med tester: geodesi, navlogg, E6B, M&B, sol, METAR, eksport
src/ui/                  kart (Leaflet), posisjon/GPS/simulator, datastripe, paneler
public/sw.js             service worker for offline app og kartfliser
```

## Prøv på iPhone uten Mac (webapp)

Repoet har `netlify.toml` i rotmappen, så appen kan publiseres gratis på Netlify. Netlify
videresender også værkallene til aviationweather.gov.

1. Logg inn på [app.netlify.com](https://app.netlify.com) med GitHub.
2. *Add new project → Import an existing project → GitHub* → velg `landing`.
3. Velg grenen som skal publiseres (`main` når PR-en er slått sammen). Innstillingene hentes fra `netlify.toml`, så trykk bare *Deploy*.
4. Åpne adressen du får (`https://….netlify.app`) i **Safari** på iPhone → *Del* → *Legg til på Hjem-skjerm*.
5. Start appen fra hjemskjermen og tillat posisjon når du trykker GPS.
