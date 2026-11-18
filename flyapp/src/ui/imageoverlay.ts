// Bilde lagt på kartet med vilkårlig rotasjon/skjevhet ut fra tre hjørner
// (Leaflets innebygde imageOverlay støtter bare rektangler nord-opp).

import L from 'leaflet';

export class AffineImageOverlay extends L.Layer {
  private img: HTMLImageElement | null = null;

  constructor(
    private url: string,
    private tl: L.LatLngExpression,
    private tr: L.LatLngExpression,
    private bl: L.LatLngExpression,
    private opts: { pane?: string; opacity?: number; className?: string } = {},
  ) {
    super();
  }

  onAdd(map: L.Map): this {
    const img = L.DomUtil.create('img', `leaflet-zoom-hide ${this.opts.className ?? ''}`) as HTMLImageElement;
    img.style.position = 'absolute';
    img.style.transformOrigin = '0 0';
    img.style.left = '0';
    img.style.top = '0';
    img.style.pointerEvents = 'none';
    img.style.opacity = String(this.opts.opacity ?? 1);
    img.alt = '';
    img.onload = () => this.reset();
    img.src = this.url;
    map.getPane(this.opts.pane ?? 'overlayPane')!.appendChild(img);
    this.img = img;
    map.on('zoomend viewreset moveend', this.reset, this);
    this.reset();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('zoomend viewreset moveend', this.reset, this);
    this.img?.remove();
    this.img = null;
    return this;
  }

  private reset(): void {
    const map = this._map;
    const img = this.img;
    if (!map || !img || !img.naturalWidth) return;
    const a = map.latLngToLayerPoint(this.tl);
    const b = map.latLngToLayerPoint(this.tr);
    const c = map.latLngToLayerPoint(this.bl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    img.style.transform = `matrix(${(b.x - a.x) / w}, ${(b.y - a.y) / w}, ${(c.x - a.x) / h}, ${(c.y - a.y) / h}, ${a.x}, ${a.y})`;
  }
}
