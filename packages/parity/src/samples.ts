// Pixel sample points generated from snapped geometry (docs/research/native-strategy.md 3.5; notes/T002-device-lanes.md 6), one
// generator for every native target. Points are whole device pixels; a pixel [x, x + 1) is clear of an edge e by the inset when
// x >= e + inset or x + 1 <= e - inset. Only edge probes cross an edge. Colours are never chosen here: check (c) compares the
// native capture with Chrome's pixels at the same points.

/** The rule kinds, in the order the generator emits them per box. Both native targets bind this list. */
export const SAMPLE_RULES = ['interior', 'border', 'outside', 'radius', 'clip', 'edge', 'glyph', 'shadow', 'gradient', 'image-flat', 'svg', 'decoration'] as const;
export type SampleRule = (typeof SAMPLE_RULES)[number];

/** Sample geometry, not a tolerance: how far a colour point stays from any edge or arc (T002 section 6). */
export const SAMPLE_INSET_DEVICE_PX = 2;

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** Where a box rule tries its point along a side (or across the padding box), in order, before it drops the point (T093 ruling A). */
export const ALONG_POSITIONS: readonly number[] = [1 / 2, 1 / 4, 3 / 4, 1 / 8, 7 / 8];

/**
 * One box in whole device px: snapped border-box edges, border band widths, one corner radius, whether it clips overflow, and its
 * layout border-box size in device px before snapping (percentage radii resolve against it).
 */
export type SampleBox = {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly border: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly radius: number;
  readonly clips: boolean;
  readonly size: readonly [number, number];
};

export type SamplePoint = { readonly x: number; readonly y: number; readonly rule: string };

export type ImageSize = { readonly width: number; readonly height: number };

/**
 * Sample points, the rules whose point was dropped because no along-position was clear of every glyph box, and the dropped edge and
 * border rules whose individually clear pixels were kept as colour points (CLEAR_SUFFIX).
 */
export type SampleResult = { readonly points: SamplePoint[]; readonly dropped: string[]; readonly rescued: string[] };

/**
 * T093 addendum F2: a dropped edge scanline or border point keeps each of its middle pixels that is itself clear of every glyph box
 * edge, as a colour point of the same rule kind named "<rule>:clear". Check (c) compares these by colour, never as a scanline.
 */
export const CLEAR_SUFFIX = ':clear';
/** Whether a sample rule is an edge scanline, whose samples check (c) reads together as one edge position. */
export const isScanlineRule = (rule: string): boolean => ruleKind(rule) === 'edge' && !rule.endsWith(CLEAR_SUFFIX);

const along = (lo: number, hi: number, f: number): number => Math.floor(lo + (hi - lo) * f);

/**
 * A glyph drawn sheared about its baseline origin (TXT-W's synthetic oblique): on the device row y its ink spans the upright left and
 * right moved by k times the height above the baseline, k * (baseline - y), device px with y down.
 */
export type GlyphSlant = { readonly k: number; readonly baseline: number; readonly left: number; readonly right: number };
/**
 * One glyph's ink box in device px, from engine data only: the pen x and the font's glyph box scaled to the instance size. A sheared
 * glyph's box is the bounding box of its ink, and slant gives the slanted sides: clearance and the glyph scanlines follow those, since
 * a slanted side runs through the bounding box.
 */
export type GlyphBox = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly slant?: GlyphSlant };
/** A line box's inked glyphs in drawing order; id is the line id "<text>:line<j>". */
export type GlyphLine = { readonly id: string; readonly glyphs: readonly GlyphBox[] };

/** The glyph's ink [left, right) at device height y (the bounding box's sides for an upright glyph). */
export function glyphSpanAt(g: GlyphBox, y: number): readonly [number, number] {
  if (g.slant === undefined) return [g.left, g.right];
  const s = g.slant.k * (g.slant.baseline - y);
  return [g.slant.left + s, g.slant.right + s];
}

/**
 * The largest d >= 0 with f(d) >= 0, for f continuous, decreasing and linear between the given breakpoints (and past the last);
 * 0 when f(0) < 0.
 */
function lastNonNegative(f: (d: number) => number, breaks: readonly number[]): number {
  const at = [0, ...[...new Set(breaks.filter((b) => b > 0))].sort((a, b) => a - b)];
  if (f(0) < 0) return 0;
  for (let i = 0; i < at.length; i++) {
    const a = at[i] as number;
    const last = i === at.length - 1;
    const b = last ? a + 1 : (at[i + 1] as number);
    const fa = f(a);
    const fb = f(b);
    if (!last && fb >= 0) continue;
    return a + (fa * (b - a)) / (fa - fb);
  }
  return 0;
}

/**
 * How far the pixel [x, x + 1) x [y, y + 1) is from the edges of a glyph box: the largest d with the pixel inside the box shrunk by
 * d or outside the box grown by d; 0 when it touches or straddles an edge. Each glyph box is its own obstacle, so a seam between two
 * glyphs is an edge of both. A sheared glyph's edges are its slanted sides and its top and bottom: shrunk or grown by d, the
 * pixel's rows (grown by d) must lie inside the ink's span on every row, or wholly beside it on the rows they share with the glyph.
 */
export function glyphClearance(x: number, y: number, g: GlyphBox): number {
  if (g.slant === undefined) {
    const inside = Math.min(x - g.left, g.right - (x + 1), y - g.top, g.bottom - (y + 1));
    if (inside >= 0) return inside;
    return Math.max(0, g.left - (x + 1), x - g.right, g.top - (y + 1), y - g.bottom);
  }
  // The span moves linearly with y, so its extremes over the pixel's rows are at y and y + 1.
  const [l0, r0] = glyphSpanAt(g, y);
  const [l1, r1] = glyphSpanAt(g, y + 1);
  const inside = Math.min(x - Math.max(l0, l1), Math.min(r0, r1) - (x + 1), y - g.top, g.bottom - (y + 1));
  if (inside >= 0) return inside;
  // Grown by d, the pixel covers rows [y - d, y + 1 + d]; those it shares with the glyph are [y0, y1], or its nearer edge row while it
  // shares none (the top or bottom gap then holds the pixel clear). Each gap below is linear in d between the d at which y0 or y1
  // reaches the top or the bottom, or the two meet.
  const rows = (d: number): readonly [number, number] => {
    const y0 = Math.max(y - d, g.top);
    const y1 = Math.min(y + 1 + d, g.bottom);
    if (y0 <= y1) return [y0, y1];
    const edge = y + 1 + d < g.top ? g.top : g.bottom;
    return [edge, edge];
  };
  const breaks = [y - g.top, g.bottom - y - 1, g.top - y - 1, y - g.bottom];
  const leftGap = lastNonNegative((d) => {
    const [y0, y1] = rows(d);
    return Math.min(glyphSpanAt(g, y0)[0], glyphSpanAt(g, y1)[0]) - (x + 1) - d;
  }, breaks);
  const rightGap = lastNonNegative((d) => {
    const [y0, y1] = rows(d);
    return x - d - Math.max(glyphSpanAt(g, y0)[1], glyphSpanAt(g, y1)[1]);
  }, breaks);
  return Math.max(0, g.top - (y + 1), y - g.bottom, leftGap, rightGap);
}

/** Whether a pixel is at least inset device px from every edge of every glyph box. */
export function clearOfGlyphs(x: number, y: number, glyphs: readonly GlyphBox[], inset: number = SAMPLE_INSET_DEVICE_PX): boolean {
  return glyphs.every((g) => glyphClearance(x, y, g) >= inset);
}

/** Every sample point of the boxes, deterministic: boxes in order, rules in SAMPLE_RULES order, sides top, right, bottom, left. */
export function generateSamples(boxes: readonly SampleBox[], size: ImageSize, glyphs: readonly GlyphBox[] = [], inset: number = SAMPLE_INSET_DEVICE_PX): SamplePoint[] {
  return sampleBoxes(boxes, size, glyphs, inset).points;
}

/**
 * generateSamples with the dropped rules. Every colour point and every edge-scanline pixel stays inset device px clear of every
 * glyph box edge (T093 ruling A): a rule tries ALONG_POSITIONS in order and drops its point when none is clear. With no glyph
 * boxes the first position, the middle, is always taken.
 */
export function sampleBoxes(boxes: readonly SampleBox[], size: ImageSize, glyphs: readonly GlyphBox[] = [], inset: number = SAMPLE_INSET_DEVICE_PX): SampleResult {
  const out: SamplePoint[] = [];
  const dropped: string[] = [];
  const rescued: string[] = [];
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size.width && y < size.height;
  const clear = (ps: readonly (readonly [number, number])[]): boolean => ps.every(([x, y]) => clearOfGlyphs(x, y, glyphs, inset));
  // The rule's pixels at each along-position, middle first: a middle that does not fit emits nothing, as before the ruling; otherwise
  // the first position that fits and is clear is taken, and the point is dropped when none is.
  // A dropped edge or border rule passes fallback: its middle pixels, of which each clear one is kept as "<rule>:clear" (F2).
  const take = (rule: string, candidates: readonly (readonly (readonly [number, number])[] | null)[], fallback: readonly (readonly [number, number])[] | null = null): void => {
    if (candidates.length === 0 || candidates[0] === null || candidates[0] === undefined) return;
    const hit = candidates.find((ps) => ps !== null && clear(ps));
    if (hit !== undefined && hit !== null) {
      for (const [x, y] of hit) out.push({ x, y, rule });
      return;
    }
    dropped.push(rule);
    const kept = (fallback ?? []).filter(([x, y]) => inImage(x, y) && clear([[x, y]]));
    if (kept.length > 0) rescued.push(rule);
    for (const [x, y] of kept) out.push({ x, y, rule: `${rule}${CLEAR_SUFFIX}` });
  };
  const inImageOnly = (ps: readonly (readonly [number, number])[]): (readonly [number, number])[] | null => {
    const kept = ps.filter(([x, y]) => inImage(x, y));
    return kept.length === 0 ? null : kept;
  };
  const clearInside = (x: number, lo: number, hi: number): boolean => x >= lo + inset && x + 1 <= hi - inset;
  for (const b of boxes) {
    const pl = b.left + b.border.left;
    const pr = b.right - b.border.right;
    const pt = b.top + b.border.top;
    const pb = b.bottom - b.border.bottom;
    const clearOfCorners = (a: number, lo: number, hi: number): boolean => a - lo >= b.radius + inset && hi - (a + 1) >= b.radius + inset;
    const alongSide = (lo: number, hi: number): number[] => ALONG_POSITIONS.map((f) => along(lo, hi, f));

    // interior: the middle of the padding box, clear of every edge; then the other along-positions, rows first.
    {
      const cells: ([number, number] | null)[] = [];
      for (const fy of ALONG_POSITIONS) {
        for (const fx of ALONG_POSITIONS) {
          const x = along(pl, pr, fx);
          const y = along(pt, pb, fy);
          cells.push(clearInside(x, pl, pr) && clearInside(y, pt, pb) && inImage(x, y) ? [x, y] : null);
        }
      }
      take(`interior:${b.id}`, cells.map((c) => (c === null ? null : [c])));
    }

    // border: the middle of each band at least SAMPLE_INSET_DEVICE_PX wide, along the side, clear of the corners.
    for (const side of SIDES) {
      const w = b.border[side];
      if (w < inset) continue;
      const horizontal = side === 'top' || side === 'bottom';
      const band = side === 'top' ? b.top + Math.floor((w - 1) / 2) : side === 'bottom' ? b.bottom - 1 - Math.floor((w - 1) / 2) : side === 'left' ? b.left + Math.floor((w - 1) / 2) : b.right - 1 - Math.floor((w - 1) / 2);
      const [lo, hi] = horizontal ? [b.left, b.right] : [b.top, b.bottom];
      // The fallback pixels: the whole band across the side, at the middle.
      const middle = along(lo, hi, 1 / 2);
      const across: (readonly [number, number])[] = [];
      for (let k = 0; k < w; k++) {
        const p = side === 'top' ? b.top + k : side === 'bottom' ? b.bottom - 1 - k : side === 'left' ? b.left + k : b.right - 1 - k;
        across.push(horizontal ? [middle, p] : [p, middle]);
      }
      take(`border:${b.id}:${side}`, alongSide(lo, hi).map((a) => {
        const [x, y] = horizontal ? [a, band] : [band, a];
        return clearOfCorners(a, lo, hi) && inImage(x, y) ? [[x, y] as const] : null;
      }), across);
    }

    // outside: the first side, in SIDES order, whose middle pixel outside the border box is inside the image; then that side's
    // other along-positions and the later sides', until one is clear.
    {
      const at = (side: Side, f: number): readonly [number, number] => [
        side === 'top' || side === 'bottom' ? along(b.left, b.right, f) : side === 'right' ? b.right + inset : b.left - inset - 1,
        side === 'left' || side === 'right' ? along(b.top, b.bottom, f) : side === 'bottom' ? b.bottom + inset : b.top - inset - 1,
      ];
      const sides = SIDES.filter((side) => inImage(...at(side, 1 / 2)));
      take(`outside:${b.id}`, sides.flatMap((side) => ALONG_POSITIONS.map((f) => (inImage(...at(side, f)) ? [at(side, f)] : null))));
    }

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
          if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) take(`radius:${b.id}:${corner}`, [inImage(x, y) ? [[x, y]] : null]);
        }
      }
    }

    // clip: inside and outside each side of the clip rect (the padding box), along the side, clear of the corners.
    if (b.clips) {
      for (const side of SIDES) {
        const horizontal = side === 'top' || side === 'bottom';
        const edge = side === 'top' ? pt : side === 'bottom' ? pb : side === 'left' ? pl : pr;
        const inward = side === 'top' || side === 'left' ? 1 : -1;
        const inner = inward > 0 ? edge + inset : edge - inset - 1;
        const outer = inward > 0 ? edge - inset - 1 : edge + inset;
        if (!(horizontal ? clearInside(inner, pt, pb) : clearInside(inner, pl, pr))) continue;
        const [lo, hi] = horizontal ? [pl, pr] : [pt, pb];
        take(`clip:${b.id}:${side}`, alongSide(lo, hi).map((a) => (clearOfCorners(a, lo, hi) ? inImageOnly([inner, outer].map((p): readonly [number, number] => (horizontal ? [a, p] : [p, a]))) : null)));
      }
    }

    // edge: one scanline across each border-box edge, outside to inside, from a clear outside pixel to a clear inside pixel.
    if (b.right - b.left >= 2 * inset + 2 && b.bottom - b.top >= 2 * inset + 2) {
      for (const side of SIDES) {
        const horizontal = side === 'top' || side === 'bottom';
        const edge = side === 'top' ? b.top : side === 'bottom' ? b.bottom : side === 'left' ? b.left : b.right;
        const inward = side === 'top' || side === 'left' ? 1 : -1;
        const first = inward > 0 ? edge - inset - 1 : edge + inset;
        const [lo, hi] = horizontal ? [b.left, b.right] : [b.top, b.bottom];
        const scanlines = alongSide(lo, hi).map((a) => {
          if (!clearOfCorners(a, lo, hi)) return null;
          const line: (readonly [number, number])[] = [];
          for (let k = 0; k < 2 * inset + 2; k++) {
            const p = first + inward * k;
            line.push(horizontal ? [a, p] : [p, a]);
          }
          return line.every(([x, y]) => inImage(x, y)) ? line : null;
        });
        take(`edge:${b.id}:${side}`, scanlines, scanlines[0] ?? null);
      }
    }
  }
  return { points: out, dropped, rescued };
}

/** The rule kind of a sample rule string ("interior:n3" is interior). */
export function ruleKind(rule: string): SampleRule {
  const k = rule.slice(0, rule.indexOf(':'));
  if (!(SAMPLE_RULES as readonly string[]).includes(k)) throw new Error(`unknown sample rule ${rule}`);
  return k as SampleRule;
}

// ---------------------------------------------------------------- the glyph rule (P5)

const GLYPH_SIDES = ['left', 'right', 'top', 'bottom'] as const;
type GlyphSide = (typeof GLYPH_SIDES)[number];

/** The glyph-edge scanline rules: check (c) pairs left with right into a centre per line and reads the bottom edge's position. */
export const GLYPH_EDGE_RULE = /^edge:(.+):glyph-(left|right|top|bottom)$/;

/**
 * The glyph rule: an interior point of every glyph box wide and tall enough to hold one clear of its edges by the inset; one edge
 * scanline (an edge rule, so check (c) compares its position) across the left edge of the line's first glyph and one across the
 * right edge of its last, at the glyph's vertical middle; and one across the top and one across the bottom edge, each of the line's
 * first glyph where that scanline is clear, at the glyph's horizontal middle. Scanlines run from a clear outside pixel to a clear
 * inside pixel. Every point and scanline pixel stays inset device px clear of the edges of every other glyph box of the case, and
 * of the crossed glyph's other edges; a point that is not is dropped. Edges may be fractional device px; points are whole pixels.
 * Nothing here reads a capture.
 */
export function generateGlyphSamples(lines: readonly GlyphLine[], size: ImageSize, inset: number = SAMPLE_INSET_DEVICE_PX): SamplePoint[] {
  return sampleGlyphs(lines, size, inset).points;
}

/** generateGlyphSamples with the dropped rules; clearance false keeps the P5 rule, with no clearance from the other glyph boxes. */
export function sampleGlyphs(lines: readonly GlyphLine[], size: ImageSize, inset: number = SAMPLE_INSET_DEVICE_PX, clearance = true): SampleResult {
  const out: SamplePoint[] = [];
  const dropped: string[] = [];
  const all = clearance ? lines.flatMap((l) => l.glyphs) : [];
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size.width && y < size.height;
  const clear = (p: number, lo: number, hi: number): boolean => p >= lo + inset && p + 1 <= hi - inset;
  const clearOfOthers = (x: number, y: number, own: GlyphBox): boolean => all.every((g) => g === own || glyphClearance(x, y, g) >= inset);
  /** The scanline across one edge of g, or null when g cannot hold one clear of its other edges. */
  // A sheared glyph's left or right side crosses a scanline row between its positions at the row's top and bottom (the same position
  // for an upright glyph): the inside end clears the side on that row, and the outside end clears it on the rows the inset grows the
  // pixel to (glyphClearance). Its top or bottom scanline keeps clear of the slanted sides on the rows it crosses inside the glyph.
  const scanline = (g: GlyphBox, side: GlyphSide): (readonly [number, number])[] | null => {
    const horizontal = side === 'left' || side === 'right';
    const inward = side === 'left' || side === 'top' ? 1 : -1;
    let across: number;
    let near: number;
    let far: number;
    if (horizontal) {
      across = Math.floor((g.top + g.bottom) / 2);
      const [la, ra] = glyphSpanAt(g, across);
      const [lb, rb] = glyphSpanAt(g, across + 1);
      if (!clear(across, g.top, g.bottom) || Math.min(ra, rb) - Math.max(la, lb) < 2 * inset + 2) return null;
      const [lu, ru] = glyphSpanAt(g, Math.max(across - inset, g.top));
      const [ld, rd] = glyphSpanAt(g, Math.min(across + 1 + inset, g.bottom));
      [near, far] = side === 'left' ? [Math.min(lu, ld), Math.max(la, lb)] : [Math.max(ru, rd), Math.min(ra, rb)];
    } else {
      const edge = side === 'top' ? g.top : g.bottom;
      if (g.slant === undefined) {
        across = Math.floor((g.left + g.right) / 2);
        if (!clear(across, g.left, g.right)) return null;
      } else {
        // The rows the scanline crosses inside the glyph run from the edge to its first clear inside pixel.
        const inner = inward > 0 ? Math.ceil(edge + inset) + 1 : Math.floor(edge - inset) - 1;
        const [la, ra] = glyphSpanAt(g, edge);
        const [lb, rb] = glyphSpanAt(g, inner);
        const lo = Math.max(la, lb);
        const hi = Math.min(ra, rb);
        across = Math.floor((lo + hi) / 2);
        if (!clear(across, lo, hi)) return null;
      }
      if (g.bottom - g.top < 2 * inset + 2) return null;
      near = edge;
      far = edge;
    }
    // From the first pixel clear outside the edge to the first pixel clear inside it.
    const outer = inward > 0 ? Math.floor(near - inset) - 1 : Math.ceil(near + inset);
    const inner = inward > 0 ? Math.ceil(far + inset) : Math.floor(far - inset) - 1;
    const points: (readonly [number, number])[] = [];
    for (let p = outer; inward > 0 ? p <= inner : p >= inner; p += inward) points.push(horizontal ? [p, across] : [across, p]);
    return points;
  };
  const usable = (g: GlyphBox, line: (readonly [number, number])[]): boolean => line.every(([x, y]) => inImage(x, y) && clearOfOthers(x, y, g));
  for (const line of lines) {
    line.glyphs.forEach((g, k) => {
      const y = Math.floor((g.top + g.bottom) / 2);
      const [l, r] = glyphSpanAt(g, y + 0.5);
      const x = Math.floor((l + r) / 2);
      if (!(inImage(x, y) && (g.slant === undefined ? clear(x, g.left, g.right) && clear(y, g.top, g.bottom) : glyphClearance(x, y, g) >= inset))) return;
      const rule = `glyph:${line.id}:${k}`;
      if (clearOfOthers(x, y, g)) out.push({ x, y, rule });
      else dropped.push(rule);
    });
    const first = line.glyphs[0];
    const last = line.glyphs[line.glyphs.length - 1];
    if (first === undefined || last === undefined) continue;
    for (const [g, side] of [[first, 'left'], [last, 'right']] as const) {
      const points = scanline(g, side);
      if (points === null || !points.every(([x, y]) => inImage(x, y))) continue;
      const rule = `edge:${line.id}:glyph-${side}`;
      if (usable(g, points)) for (const [x, y] of points) out.push({ x, y, rule });
      else dropped.push(rule);
    }
    if (!clearance) continue;
    // The top and the bottom scanline each cross the first glyph of the line where that scanline is clear.
    for (const side of ['top', 'bottom'] as const) {
      const candidates = line.glyphs.map((g) => ({ g, points: scanline(g, side) })).filter((v): v is { g: GlyphBox; points: (readonly [number, number])[] } => v.points !== null && v.points.every(([x, y]) => inImage(x, y)));
      if (candidates.length === 0) continue;
      const rule = `edge:${line.id}:glyph-${side}`;
      const pick = candidates.find((v) => usable(v.g, v.points));
      if (pick === undefined) dropped.push(rule);
      else for (const [x, y] of pick.points) out.push({ x, y, rule });
    }
  }
  return { points: out, dropped, rescued: [] };
}
