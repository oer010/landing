// Plattformlag: samme kode kjører som iPhone-app (Capacitor) og i nettleser.

import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Basis-URL for aviationweather.gov. I iPhone-appen går kallene direkte via
 * native HTTP (CapacitorHttp, ingen CORS). I nettleser via /awc-proxyen.
 */
export const awcBase = (): string => (isNative() ? 'https://aviationweather.gov/api/data/' : './awc/api/data/');

/** Lagre/del en fil. På iPhone åpnes delingsarket (Filer, AirDrop, Garmin Pilot …). */
export async function saveFile(filename: string, content: string, mime: string): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, url: res.uri, dialogTitle: filename });
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Hold skjermen på mens GPS/simulering er aktiv. */
export async function setKeepAwake(on: boolean): Promise<void> {
  if (isNative()) {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
    return;
  }
  type Lock = { release: () => Promise<void> };
  const w = window as Window & { __wakeLock?: Lock | null };
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } };
  if (on && !w.__wakeLock) w.__wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  else if (!on && w.__wakeLock) {
    await w.__wakeLock.release();
    w.__wakeLock = null;
  }
}

export async function initNativeChrome(): Promise<void> {
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
}
