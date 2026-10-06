// Outlines (css-ui-4 §3; PNT1): the rings a solid or double outline paints around a snapped border box, in device px, as Blink 145
// paints them for square corners. Every exported function here becomes a translated engine root (translate/src/generate.ts),
// proven TS = Swift = Kotlin by packages/layout/paint-vectors/outline. Rounded outlines join with the radius module.
import { floorOf, roundOf, truncOf } from './rt-easing.ts';

/** An outline width in device px, snapped as a border width is: at least 1 device px when positive, else floored. */
export function outlineWidthPx(width: number, dpr: number): number {
  const device = width * dpr;
  if (device >= 1) return floorOf(device);
  return device > 0 ? 1 : 0;
}

/** An outline offset in device px: Blink's integer outline offset, truncated toward zero (measured: -1.4 css px is -2 at DPR 2). */
export function outlineOffsetPx(offset: number, dpr: number): number {
  return truncOf(offset * dpr);
}

/** One ring: the rect outset by outer (device px each axis) and the rect outset by inner, 8 numbers. */
function pushRing(out: number[], l: number, t: number, r: number, b: number, ox: number, oy: number, outer: number, inner: number): void {
  out.push(l - (ox + outer));
  out.push(t - (oy + outer));
  out.push(r + (ox + outer));
  out.push(b + (oy + outer));
  out.push(l - (ox + inner));
  out.push(t - (oy + inner));
  out.push(r + (ox + inner));
  out.push(b + (oy + inner));
}

/**
 * The rings a solid or double outline paints around a snapped square border box (edges in device px) at a device width and offset
 * (outlineWidthPx, outlineOffsetPx): 8 numbers per ring, the outer rect (left, top, right, bottom), then the inner rect. Blink 145:
 * outline_painter.cc:74-80 AdjustedOutlineOffset (a negative offset shrinks the rect by at most half its size, per axis, in int
 * division), box_border_painter.cc:1359-1393 (the ring between the rect outset by offset + width and by offset), and for double the
 * two bands of round(width / 3) at either edge (outline_painter.cc:518-536; a width of 2 or less is solid, :448-449). A zero width
 * paints nothing.
 */
export function outlineRings(left: number, top: number, right: number, bottom: number, width: number, offset: number, double: boolean): number[] {
  const out: number[] = [];
  if (width <= 0) return out;
  const oy = offset > -truncOf((bottom - top) / 2) ? offset : -truncOf((bottom - top) / 2);
  const ox = offset > -truncOf((right - left) / 2) ? offset : -truncOf((right - left) / 2);
  if (!double || width <= 2) {
    pushRing(out, left, top, right, bottom, ox, oy, width, 0);
    return out;
  }
  const band = roundOf(width / 3);
  pushRing(out, left, top, right, bottom, ox, oy, width, width - band);
  pushRing(out, left, top, right, bottom, ox, oy, band, 0);
  return out;
}
