declare module '*/scripts/build-data.mjs' {
  export function parseCsv(text: string): Record<string, string>[];
}
declare module '*/scripts/aip.mjs' {
  export function cleanAipHtml(html: string): string;
  export function parseAd218(html: string, ident: string): { svc: string; call: string; mhz: number[]; hr: string; rmk: string }[];
}
declare module '*/scripts/vfr.mjs' {
  export function parseChartPoints(text: string): { n: string; lat: number; lon: number }[];
  export function isVfrChart(title: string): boolean;
}
declare module '*/scripts/vfrsymbols.mjs' {
  export function findSymbols(svg: string): { x: number; y: number; filled: boolean }[];
  export function gridFit(words: { x0: number; y0: number; x1: number; y1: number; w: string }[]): { toLL(x: number, y: number): { lat: number; lon: number } } | null;
}
