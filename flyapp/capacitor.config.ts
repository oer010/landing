import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'no.vfrflyapp.app',
  appName: 'VFR Flyapp',
  webDir: 'dist',
  backgroundColor: '#0b1220',
  ios: {
    contentInset: 'never',
    // Swift Package Manager: ingen CocoaPods nødvendig.
    // Bygges i Xcode på Mac.
  },
  plugins: {
    // Native HTTP: lar appen hente METAR/TAF direkte fra aviationweather.gov
    // uten CORS-proxy.
    CapacitorHttp: { enabled: true },
    StatusBar: { overlaysWebView: true, style: 'DARK', backgroundColor: '#000000' },
  },
};

export default config;
