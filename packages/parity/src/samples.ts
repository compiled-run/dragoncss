// Pixel sample points generated from snapped geometry (docs/research/native-strategy.md 3.5; notes/T002-device-lanes.md 6), one
// generator for every native target. Points are whole device pixels; a pixel [x, x + 1) is clear of an edge e by the inset when
// x >= e + inset or x + 1 <= e - inset. Only edge probes cross an edge. Colours are never chosen here: check (c) compares the
// native capture with Chrome's pixels at the same points.

/** The rule kinds, in the order the generator emits them per box. Both native targets bind this list. */
export const SAMPLE_RULES = ['interior', 'border', 'outside', 'radius', 'clip', 'edge', 'glyph'] as const;
export type SampleRule = (typeof SAMPLE_RULES)[number];

/** Sample geometry, not a tolerance: how far a colour point stays from any edge or arc (T002 section 6). */
export const SAMPLE_INSET_DEVICE_PX = 2;

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** One box in whole device px: snapped border-box edges, border band widths, one corner radius, and whether it clips overflow. */
export type SampleBox = {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly border: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly radius: number;
  readonly clips: boolean;
};

export type SamplePoint = { readonly x: number; readonly y: number; readonly rule: string };

export type ImageSize = { readonly width: number; readonly height: number };

const mid = (a: number, b: number): number => Math.floor((a + b) / 2);

/** Every sample point of the boxes, deterministic: boxes in order, rules in SAMPLE_RULES order, sides top, right, bottom, left. */
export function generateSamples(boxes: readonly SampleBox[], size: ImageSize, inset: number = SAMPLE_INSET_DEVICE_PX): SamplePoint[] {
  const out: SamplePoint[] = [];
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size.width && y < size.height;
  const push = (x: number, y: number, rule: string): boolean => {
    if (!inImage(x, y)) return false;
    out.push({ x, y, rule });
    return true;
  };
  const clearInside = (x: number, lo: number, hi: number): boolean => x >= lo + inset && x + 1 <= hi - inset;
  for (const b of boxes) {
    const cx = mid(b.left, b.right);
    const cy = mid(b.top, b.bottom);
    const pl = b.left + b.border.left;
    const pr = b.right - b.border.right;
    const pt = b.top + b.border.top;
    const pb = b.bottom - b.border.bottom;
    const clearOfCorners = (along: number, lo: number, hi: number): boolean => along - lo >= b.radius + inset && hi - (along + 1) >= b.radius + inset;

    // interior: the middle of the padding box, clear of every edge.
    const ix = mid(pl, pr);
    const iy = mid(pt, pb);
    if (clearInside(ix, pl, pr) && clearInside(iy, pt, pb)) push(ix, iy, `interior:${b.id}`);

    // border: the middle of each band at least SAMPLE_INSET_DEVICE_PX wide, at the middle of the side, clear of the corners.
    for (const side of SIDES) {
      const w = b.border[side];
      if (w < inset) continue;
      const horizontal = side === 'top' || side === 'bottom';
      if (!(horizontal ? clearOfCorners(cx, b.left, b.right) : clearOfCorners(cy, b.top, b.bottom))) continue;
      const band = side === 'top' ? b.top + Math.floor((w - 1) / 2) : side === 'bottom' ? b.bottom - 1 - Math.floor((w - 1) / 2) : side === 'left' ? b.left + Math.floor((w - 1) / 2) : b.right - 1 - Math.floor((w - 1) / 2);
      push(horizontal ? cx : band, horizontal ? band : cy, `border:${b.id}:${side}`);
    }

    // outside: the first side, in SIDES order, with a clear pixel outside the border box inside the image.
    const outside: readonly (readonly [number, number])[] = [[cx, b.top - inset - 1], [b.right + inset, cy], [cx, b.bottom + inset], [b.left - inset - 1, cy]];
    for (const [x, y] of outside) if (push(x, y, `outside:${b.id}`)) break;

    // radius: along each corner diagonal, at radius - inset (painted) and radius + inset (not painted) from the arc centre.
    if (b.radius > inset) {
      for (const corner of CORNERS) {
        const sx = corner.endsWith('left') ? -1 : 1;
        const sy = corner.startsWith('top') ? -1 : 1;
        const ax = sx < 0 ? b.left + b.radius : b.right - b.radius;
        const ay = sy < 0 ? b.top + b.radius : b.bottom - b.radius;
        for (const d of [b.radius - inset, b.radius + inset]) {
          const x = Math.floor(ax + sx * d * Math.SQRT1_2);
          const y = Math.floor(ay + sy * d * Math.SQRT1_2);
          if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) push(x, y, `radius:${b.id}:${corner}`);
        }
      }
    }

    // clip: inside and outside each side of the clip rect (the padding box), at the middle of the side, clear of the corners.
    if (b.clips) {
      for (const side of SIDES) {
        const horizontal = side === 'top' || side === 'bottom';
        const along = horizontal ? mid(pl, pr) : mid(pt, pb);
        if (!(horizontal ? clearOfCorners(along, pl, pr) : clearOfCorners(along, pt, pb))) continue;
        const edge = side === 'top' ? pt : side === 'bottom' ? pb : side === 'left' ? pl : pr;
        const inward = side === 'top' || side === 'left' ? 1 : -1;
        const inner = inward > 0 ? edge + inset : edge - inset - 1;
        const outer = inward > 0 ? edge - inset - 1 : edge + inset;
        if (!(horizontal ? clearInside(inner, pt, pb) : clearInside(inner, pl, pr))) continue;
        push(horizontal ? along : inner, horizontal ? inner : along, `clip:${b.id}:${side}`);
        push(horizontal ? along : outer, horizontal ? outer : along, `clip:${b.id}:${side}`);
      }
    }

    // edge: one scanline across each border-box edge, outside to inside, from a clear outside pixel to a clear inside pixel.
    if (b.right - b.left >= 2 * inset + 2 && b.bottom - b.top >= 2 * inset + 2) {
      for (const side of SIDES) {
        const horizontal = side === 'top' || side === 'bottom';
        const along = horizontal ? cx : cy;
        if (!(horizontal ? clearOfCorners(along, b.left, b.right) : clearOfCorners(along, b.top, b.bottom))) continue;
        const edge = side === 'top' ? b.top : side === 'bottom' ? b.bottom : side === 'left' ? b.left : b.right;
        const inward = side === 'top' || side === 'left' ? 1 : -1;
        const first = inward > 0 ? edge - inset - 1 : edge + inset;
        const count = 2 * inset + 2;
        const line: (readonly [number, number])[] = [];
        for (let k = 0; k < count; k++) {
          const p = first + inward * k;
          line.push(horizontal ? [along, p] : [p, along]);
        }
        if (!line.every(([x, y]) => inImage(x, y))) continue;
        for (const [x, y] of line) push(x, y, `edge:${b.id}:${side}`);
      }
    }
  }
  return out;
}

/** The rule kind of a sample rule string ("interior:n3" is interior). */
export function ruleKind(rule: string): SampleRule {
  const k = rule.slice(0, rule.indexOf(':'));
  if (!(SAMPLE_RULES as readonly string[]).includes(k)) throw new Error(`unknown sample rule ${rule}`);
  return k as SampleRule;
}

// ---------------------------------------------------------------- the glyph rule (P5)

/** One glyph's ink box in device px, from engine data only: the pen x and the font's glyph box scaled to the instance size. */
export type GlyphBox = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
/** A line box's inked glyphs in drawing order; id is the line id "<text>:line<j>". */
export type GlyphLine = { readonly id: string; readonly glyphs: readonly GlyphBox[] };

/**
 * The glyph rule: an interior point of every glyph box wide and tall enough to hold one clear of its edges by the inset, then one
 * edge scanline (an edge rule, so check (c) compares its position) across the left edge of the line's first glyph and one across
 * the right edge of its last, at the glyph's vertical middle, from a clear outside pixel to a clear inside pixel. Edges may be
 * fractional device px; points are whole pixels. Nothing here reads a capture.
 */
export function generateGlyphSamples(lines: readonly GlyphLine[], size: ImageSize, inset: number = SAMPLE_INSET_DEVICE_PX): SamplePoint[] {
  const out: SamplePoint[] = [];
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size.width && y < size.height;
  const clear = (p: number, lo: number, hi: number): boolean => p >= lo + inset && p + 1 <= hi - inset;
  for (const line of lines) {
    line.glyphs.forEach((g, k) => {
      const x = Math.floor((g.left + g.right) / 2);
      const y = Math.floor((g.top + g.bottom) / 2);
      if (clear(x, g.left, g.right) && clear(y, g.top, g.bottom) && inImage(x, y)) out.push({ x, y, rule: `glyph:${line.id}:${k}` });
    });
    const first = line.glyphs[0];
    const last = line.glyphs[line.glyphs.length - 1];
    if (first === undefined || last === undefined) continue;
    for (const [g, side] of [[first, 'left'], [last, 'right']] as const) {
      const y = Math.floor((g.top + g.bottom) / 2);
      if (!clear(y, g.top, g.bottom) || g.right - g.left < 2 * inset + 2) continue;
      const edge = side === 'left' ? g.left : g.right;
      const inward = side === 'left' ? 1 : -1;
      // From the first pixel clear outside the edge to the first pixel clear inside it.
      const outer = inward > 0 ? Math.floor(edge - inset) - 1 : Math.ceil(edge + inset);
      const inner = inward > 0 ? Math.ceil(edge + inset) : Math.floor(edge - inset) - 1;
      const points: number[] = [];
      for (let p = outer; inward > 0 ? p <= inner : p >= inner; p += inward) points.push(p);
      if (!points.every((p) => inImage(p, y))) continue;
      for (const p of points) out.push({ x: p, y, rule: `edge:${line.id}:glyph-${side}` });
    }
  }
  return out;
}
