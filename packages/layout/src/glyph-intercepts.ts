// TDEC-d for real faces: where a glyph's outline crosses the skip-ink band of an under or overline, as Skia finds it for Blink's
// TextPainter::ClipDecorationsStripe (SkTextBlob::getIntercepts, get_glyph_run_intercepts, SkGlyph::ensureIntercepts at Skia
// 2ab8add5): the glyph's path at kCanonicalTextSizeForPaths, the band scaled into that space around the glyph's baseline, every
// line and quad crossing of the band's two edges and every path point strictly inside it, scaled back and offset by the pen x.
// TrueType contours become Skia's path as CoreText hands it over (on-curve points joined by lines, off-curve points as quad
// controls with implied on-curve midpoints between two of them). Doubles where Skia works in doubles (SkDQuad), float32 elsewhere.
import type { GlyphInk } from './text-decoration.ts';

/** SkFontPriv::kCanonicalTextSizeForPaths: the size Skia builds glyph paths at for intercepts. */
export const CANONICAL_TEXT_SIZE_FOR_PATHS = 64;

/** A TrueType outline point in font units, y up. */
export type OutlinePoint = { readonly x: number; readonly y: number; readonly on: boolean };

/** Plants: control points join the points inside the band (Skia's AddPoints over a quad's three points), or the paths are built at the drawn size. */
export type InterceptFaults = { readonly endpointsOnly: boolean; readonly drawnSizePath: boolean };
export const NO_INTERCEPT_FAULTS: InterceptFaults = { endpointsOnly: false, drawnSizePath: false };

const f32 = Math.fround;

type Pt = { readonly x: number; readonly y: number };
type Segment = { readonly kind: 'line'; readonly p: readonly [Pt, Pt] } | { readonly kind: 'quad'; readonly p: readonly [Pt, Pt, Pt] };

/** A contour as path segments: implied on-curve midpoints between consecutive off-curve points, walked from an on-curve point. */
function contourSegments(c: readonly Pt[], on: readonly boolean[]): Segment[] {
  const n = c.length;
  if (n === 0) return [];
  const full: { readonly p: Pt; readonly on: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const p = c[i] as Pt;
    const next = c[(i + 1) % n] as Pt;
    full.push({ p, on: on[i] === true });
    if (on[i] !== true && on[(i + 1) % n] !== true) full.push({ p: { x: f32((p.x + next.x) / 2), y: f32((p.y + next.y) / 2) }, on: true });
  }
  const start = full.findIndex((q) => q.on);
  if (start < 0) return [];
  const m = full.length;
  const out: Segment[] = [];
  let pen = (full[start] as { p: Pt }).p;
  let control: Pt | null = null;
  for (let k = 1; k <= m; k++) {
    const q = full[(start + k) % m] as { readonly p: Pt; readonly on: boolean };
    if (!q.on) {
      control = q.p;
      continue;
    }
    out.push(control === null ? { kind: 'line', p: [pen, q.p] } : { kind: 'quad', p: [pen, control, q.p] });
    pen = q.p;
    control = null;
  }
  return out;
}

/** Veltkamp split and Dekker's product: a * b exactly as hi + lo. */
function twoProduct(a: number, b: number): [number, number] {
  const p = a * b;
  const split = (x: number): [number, number] => {
    const c = 134217729 * x;
    const hi = c - (c - x);
    return [hi, x - hi];
  };
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}

/** std::fma: a * b + c rounded once (exact product, then a compensated sum). */
export function fma(a: number, b: number, c: number): number {
  const [p, e] = twoProduct(a, b);
  const s = p + c;
  const bb = s - p;
  const err = (p - (s - bb)) + (c - bb);
  return s + (err + e);
}

/** SkQuads::Discriminant: b * b - a * c, with fma's rounding errors added back when the rough value loses more than 2 bits. */
function discriminant(a: number, b: number, c: number): number {
  const b2 = b * b;
  const ac = a * c;
  const rough = b2 - ac;
  if (3 * Math.abs(rough) >= b2 + ac) return rough;
  return (b2 - ac) + (fma(b, b, -b2) - fma(a, c, -ac));
}

/** SkQuads::Roots for A t^2 - 2 B t + C = 0. */
function quadRoots(A: number, B: number, C: number): [number, number] {
  const d = discriminant(A, B, C);
  if (A === 0) {
    const r = B === 0 ? (C === 0 ? Number.POSITIVE_INFINITY : Number.NaN) : C / (2 * B);
    return [r, r];
  }
  if (d === 0) return [B / A, B / A];
  if (d > 0) {
    const D = Math.sqrt(d);
    const R = B > 0 ? B + D : B - D;
    return [R / A, C / R];
  }
  return [Number.NaN, Number.NaN];
}

/** SkBezierCurves pinTRange: 0 or 1 within half a float ulp of them. */
function pinTRange(t: number): number {
  if (f32(t + 1) === 1) return 0;
  if (f32(t) === 1) return 1;
  return t;
}

/** SkBezierQuad::IntersectWithHorizontalLine: the x of each crossing of y with the quad, in doubles, each rounded to float. */
function quadCrossings(p0: Pt, p1: Pt, p2: Pt, y: number): number[] {
  const AX = p0.x - 2 * p1.x + p2.x;
  const BX = p0.x - p1.x;
  const CX = p0.x;
  const AY = p0.y - 2 * p1.y + p2.y;
  const BY = p0.y - p1.y;
  const [r0, r1] = quadRoots(AY, BY, p0.y - y);
  const out: number[] = [];
  const t0 = pinTRange(r0);
  if (t0 >= 0 && t0 <= 1) out.push(f32(fma(fma(AX, t0, -2 * BX), t0, CX)));
  const t1 = pinTRange(r1);
  if (t1 >= 0 && t1 <= 1 && t1 !== t0) out.push(f32(fma(fma(AX, t1, -2 * BX), t1, CX)));
  return out;
}

/**
 * The [left, right] x range in px where one glyph's outline meets the band [bandTop, bandBottom] (px, y down, absolute), or null
 * when it does not: unitsPerEm and contours from the face, size the drawn size, (penX, baselineY) the glyph's origin.
 */
export function glyphIntercept(contours: readonly (readonly OutlinePoint[])[], unitsPerEm: number, size: number, penX: number, baselineY: number, bandTop: number, bandBottom: number, faults: InterceptFaults = NO_INTERCEPT_FAULTS): readonly [number, number] | null {
  const pathSize = faults.drawnSizePath ? size : CANONICAL_TEXT_SIZE_FOR_PATHS;
  const scale = f32(size / pathSize);
  const k = pathSize / unitsPerEm;
  const b0 = f32(f32(bandTop - baselineY) / scale);
  const b1 = f32(f32(bandBottom - baselineY) / scale);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const segments: Segment[] = [];
  for (const contour of contours) {
    const pts = contour.map((q): Pt => ({ x: f32(q.x * k), y: f32(-q.y * k) }));
    for (const q of pts) {
      top = Math.min(top, q.y);
      bottom = Math.max(bottom, q.y);
    }
    segments.push(...contourSegments(pts, contour.map((q) => q.on)));
  }
  if (segments.length === 0 || bottom < b0 || b1 < top) return null;
  const take = (x: number): void => {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  };
  const points = (ps: readonly Pt[]): void => {
    for (const q of ps) if (b0 < q.y && q.y < b1) take(q.x);
  };
  for (const s of segments) {
    if (s.kind === 'line') {
      const [a, b] = s.p;
      for (const axis of [b0, b1]) {
        const t = f32(f32(axis - a.y) / f32(b.y - a.y));
        if (t >= 0 && t < 1) take(f32(a.x + f32(t * f32(b.x - a.x))));
      }
      points(s.p);
    } else {
      const [a, c, b] = s.p;
      for (const axis of [b0, b1]) for (const x of quadCrossings(a, c, b, axis)) take(x);
      points(faults.endpointsOnly ? [a, b] : s.p);
    }
  }
  if (!(lo < hi)) return null;
  return [f32(f32(lo * scale) + penX), f32(f32(hi * scale) + penX)];
}

/** Each glyph's intercept as the ink box skipInkClips reads: its x range, and the band itself as its y extent. */
export function interceptInk(intercepts: readonly (readonly [number, number] | null)[], bandTop: number, bandBottom: number): GlyphInk[] {
  return intercepts.flatMap((i) => (i === null ? [] : [{ left: i[0], right: i[1], top: bandTop, bottom: bandBottom }]));
}
