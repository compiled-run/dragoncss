// GEN-c (notes/T151-gen-spec.md R14): an outside disc or square list marker as Blink 145 paints it (text_fragment_painter.cc
// PaintSymbol; docs/research/gen-spike/blink-notes.md "Marker paint"). The rect is marker.ts symbolPaintRect. A square fills its
// whole-px rect; a disc is SkCanvas::drawOval, the oval path filled by Skia's analytic AA (paint-aa.ts AntiFillPath) straight onto
// the tile. scripts/check-marker-paint-oracle.ts proves both pixel-exact against Chrome at DPR 1, 2, 3 and 2.625. A circle is a 1
// device px hairline Dragon does not draw, so the compiler refuses it on native. Every exported function is a translated root.
import type { Ctx } from './block.ts';
import type { ListMarker } from './input.ts';
import { symbolPaintRect } from './marker.ts';
import type { Device, IRect } from './paint-aa.ts';
import { antiFillPath, devicePixels, NO_AA_FAULTS, ovalPath, whiteDevice } from './paint-aa.ts';
import type { LU } from './units.ts';

/** A marker's paint in device px from the root: its rect and the coverage (0 to 255) of each pixel in it, row-major. */
export type MarkerPaint = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly coverage: readonly number[] };

/** The coverage of a disc or square over its rect in device px, row-major; empty for an empty rect. */
export function symbolCoverage(symbol: string, left: number, top: number, right: number, bottom: number): number[] {
  const out: number[] = [];
  if (!(left < right && top < bottom)) return out;
  if (symbol === 'square') {
    for (let k = 0; k < (right - left) * (bottom - top); k++) out.push(255);
    return out;
  }
  if (symbol !== 'disc') throw new Error(`a ${symbol} marker is not drawn natively (only disc and square are)`);
  // Chrome's ink stays inside the rect, so the rect is both the device crop and a clip that holds the whole path.
  const b: IRect = { left, top, right, bottom };
  const dev: Device = whiteDevice(b);
  antiFillPath(dev, ovalPath({ left, top, right, bottom }), b, NO_AA_FAULTS);
  for (const v of devicePixels(dev)) out.push(255 - v);
  return out;
}

/** The paint of a symbol marker whose box is at (x, y) in LU from the root, in the zoomed context of the layout. */
export function markerSymbolPaint(ctx: Ctx, m: ListMarker, x: LU, y: LU): MarkerPaint {
  const r = symbolPaintRect(ctx, m, x, y);
  const symbol = m.symbol === null ? '' : m.symbol;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, coverage: symbolCoverage(symbol, r.left, r.top, r.right, r.bottom) };
}
