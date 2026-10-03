// CSS gradient background layers as Chrome 145 rasters them on the CPU (BG2, notes/T046-paint-spec.md §1 and §5.4):
// Blink 145.0.7632.6's gradient geometry (core/css/css_gradient_value.cc CreateGradient, EndPointsFromAngle, AddStops,
// RadiusToSide/RadiusToCorner) and background tile geometry (core/paint/background_image_geometry.cc, box_painter_base.cc
// DrawTiledBackground's single-tile draw, platform/graphics/gradient_generated_image.cc Draw), then Skia 2ab8add5's shader
// setup (SkGradientBaseShader, SkLinearGradient/SkRadialGradient pts_to_unit, SkMatrix concat and invert, MatrixRec::apply)
// and the highp raster pipeline (seed_shader, the matrix stages, xy_to_radius, repeat_x_1/clamp_x_1, the gradient stages,
// dither, clamp and srcover), reusing paint-dither.ts's stop stages, dither, NEON fma and store. Float32 steps are fround
// per operation (Chromium builds with -ffp-contract=off); the raster pipeline's mad is a fused float32 FMA. No libm call is
// made here: the linear slope (Blink's tan of a float) arrives as an input the compiler folds from the measured capture-host
// table (notes/T074-bg2-spec.md R3), and a corner direction, whose slope needs atan2 and tan of the box size, is not modelled.
// The cc raster tiles, the dither and the shader matrix start at the box's composited layer (R4), an input. Every exported
// function is a translated engine root, proven TS = Swift = Kotlin by packages/layout/paint-vectors/gradient.
import { ccTileIndex, ccTileSize, ccTileStart, ditherOffset, fma32, roundHalfEven } from './paint-dither.ts';
import { floorOf, froundOf, truncOf } from './rt-easing.ts';

/** Planted faults: each must make the Chrome pixel oracle or a device lane fail. */
export type GradientFaults = {
  /** Every layer drawn one device pixel right of Chrome's (the gradient-offset-1 plant). */
  readonly offsetOne: boolean;
  /** Stops interpolated unpremultiplied (CAGradientLayer's model). */
  readonly unpremultiplied: boolean;
  /** No dither. */
  readonly ditherOff: boolean;
  /** The cc tiles, dither and shader matrix start at the page, not at the box's composited layer. */
  readonly layerOriginIgnored: boolean;
  /** Each single-tile layer drawn by the other of Blink's two models (direct for the picture shader, and the reverse). */
  readonly singleTileModelSwapped: boolean;
  /** A border side that obscures the background (BorderEdge::ObscuresBackground) does not cut a border-box layer's dest. */
  readonly obscuredBorderIgnored: boolean;
};

export const NO_GRADIENT_FAULTS: GradientFaults = { offsetOne: false, unpremultiplied: false, ditherOff: false, layerOriginIgnored: false, singleTileModelSwapped: false, obscuredBorderIgnored: false };

/** The faults of a raster: none, or one plant by name (the device's gradient-offset-1 plant is 'offsetOne'). */
export function gradientFaults(plant: string): GradientFaults {
  return {
    offsetOne: plant === 'offsetOne',
    unpremultiplied: plant === 'unpremultiplied',
    ditherOff: plant === 'ditherOff',
    layerOriginIgnored: plant === 'layerOriginIgnored',
    singleTileModelSwapped: plant === 'singleTileModelSwapped',
    obscuredBorderIgnored: plant === 'obscuredBorderIgnored',
  };
}

function f32(v: number): number {
  return froundOf(v);
}

function absNum(v: number): number {
  return v < 0 ? -v : v;
}

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact arithmetic the translator subset lacks: a fused double multiply-add, correctly rounded square roots, hypotf and fmodf.

const SPLIT = 134217729;

/**
 * A double fused multiply-add (arm64 fmadd): a * b + c with one rounding. Dekker's split gives the product exactly as
 * hi + lo; TwoSum adds c exactly; the two error terms are then added before the final rounding.
 */
export function fma64(a: number, b: number, c: number): number {
  const p = a * b;
  const a1 = a * SPLIT;
  const ah = a1 - (a1 - a);
  const al = a - ah;
  const b1 = b * SPLIT;
  const bh = b1 - (b1 - b);
  const bl = b - bh;
  const lo = ah * bh - p + ah * bl + al * bh + al * bl;
  const s = p + c;
  const bb = s - p;
  const t = p - (s - bb) + (c - bb);
  return s + (t + lo);
}

/** The exact square of a double as hi + lo (Dekker), returned as the residual x - v * v. */
function sqrtResidual(x: number, v: number): number {
  const p = v * v;
  const a1 = v * SPLIT;
  const ah = a1 - (a1 - v);
  const al = v - ah;
  const lo = ah * ah - p + 2 * ah * al + al * al;
  return x - p - lo;
}

/** The correctly rounded double square root of x >= 0 (IEEE sqrt): Newton's method on [1, 4), then exact midpoint tests. */
export function sqrtF64(x: number): number {
  if (x === 0 || x !== x) return x;
  if (x < 0) return 0 / 0;
  if (x === 1 / 0) return x;
  let m = x;
  let scale = 1;
  while (m >= 4) {
    m = m / 4;
    scale = scale * 2;
  }
  while (m < 1) {
    m = m * 4;
    scale = scale / 2;
  }
  let y = (m + 1) / 2;
  for (let i = 0; i < 8; i++) y = (y + m / y) / 2;
  // sqrt(m) is in [1, 2), where the ulp is 2^-52; (y +- u/2)^2 = y^2 +- y*u + u^2/4 against the exact residual m - y^2.
  const u = 2.220446049250313e-16;
  const q = u * u / 4;
  for (let i = 0; i < 4; i++) {
    const r = sqrtResidual(m, y);
    if (r > y * u + q) y = y + u;
    else if (r < -(y * u) + q && y > 1) y = y - u;
    else i = 4;
  }
  return y * scale;
}

/** vsqrtq_f32 and sqrtf: the correctly rounded float square root (a double's correct sqrt rounds to the float's). */
export function sqrtF32(x: number): number {
  return f32(sqrtF64(x));
}

/** Apple libm hypotf, measured equal to (float)sqrt((double)x * x + (double)y * y) on the capture host. */
export function hypotF32(x: number, y: number): number {
  return f32(sqrtF64(x * x + y * y));
}

/** fmodf(a, m) for float a and a positive integer m: exact, with the sign of a. */
export function fmodF32(a: number, m: number): number {
  if (a !== a) return a;
  const q = truncOf(a / m);
  let r = a - q * m;
  if (a >= 0) {
    if (r < 0) r = r + m;
    if (r >= m) r = r - m;
  } else {
    if (r > 0) r = r - m;
    if (r <= -m) r = r + m;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// SkMatrix (src/core/SkMatrix.cpp) for affine matrices: the type mask, concat (muladdmul in double), invert (the double
// determinant), setSinCos, post/pre translate and scale, Rect2Rect, and SkRasterPipeline::appendMatrix's stage choice.

/** An affine SkMatrix: [scaleX skewX transX; skewY scaleY transY; 0 0 1], every entry a float32 value. */
export type Mat = { readonly sx: number; readonly kx: number; readonly tx: number; readonly ky: number; readonly sy: number; readonly ty: number };

export const IDENTITY: Mat = { sx: 1, kx: 0, tx: 0, ky: 0, sy: 1, ty: 0 };

function mat(sx: number, kx: number, tx: number, ky: number, sy: number, ty: number): Mat {
  return { sx, kx, tx, ky, sy, ty };
}

/** getType(): 0 identity, 1 translate, 2 scale, 4 affine (with scale), or'ed. -0 counts as 0 (SkScalarAs2sCompliment). */
export function matType(m: Mat): number {
  let t = 0;
  if (m.tx !== 0 || m.ty !== 0) t = t + 1;
  if (m.kx !== 0 || m.ky !== 0) return t + 2 + 4;
  if (m.sx !== 1 || m.sy !== 1) t = t + 2;
  return t;
}

function onlyScaleTranslate(type: number): boolean {
  return type < 4;
}

/** setConcat(a, b) = a * b. */
export function matConcat(a: Mat, b: Mat): Mat {
  const at = matType(a);
  const bt = matType(b);
  if (at === 0) return b;
  if (bt === 0) return a;
  if (onlyScaleTranslate(at) && onlyScaleTranslate(bt)) {
    return mat(f32(a.sx * b.sx), 0, f32(f32(a.sx * b.tx) + a.tx), 0, f32(a.sy * b.sy), f32(f32(a.sy * b.ty) + a.ty));
  }
  return mat(
    f32(a.sx * b.sx + a.kx * b.ky),
    f32(a.sx * b.kx + a.kx * b.sy),
    f32(f32(a.sx * b.tx + a.kx * b.ty) + a.tx),
    f32(a.ky * b.sx + a.sy * b.ky),
    f32(a.ky * b.kx + a.sy * b.sy),
    f32(f32(a.ky * b.tx + a.sy * b.ty) + a.ty),
  );
}

/** invert(); null when the matrix is singular or the inverse not finite. */
export function matInvert(m: Mat): Mat | null {
  const t = matType(m);
  if (t === 0) return m;
  if (t < 4) {
    if (t >= 2) {
      const isx = f32(1 / m.sx);
      const isy = f32(1 / m.sy);
      if (!isFiniteNum(isx) || !isFiniteNum(isy)) return null;
      const itx = f32(-m.tx * isx);
      const ity = f32(-m.ty * isy);
      if (!isFiniteNum(itx) || !isFiniteNum(ity)) return null;
      return mat(isx, 0, itx, 0, isy, ity);
    }
    if (!isFiniteNum(m.tx) || !isFiniteNum(m.ty)) return null;
    return mat(1, 0, -m.tx, 0, 1, -m.ty);
  }
  const det = m.sx * m.sy - m.kx * m.ky;
  const nearly = 1.4551915228366852e-11;
  if (absNum(f32(det)) <= nearly) return null;
  const inv = 1 / det;
  const out = mat(f32(m.sy * inv), f32(-m.kx * inv), f32((m.kx * m.ty - m.sy * m.tx) * inv), f32(-m.ky * inv), f32(m.sx * inv), f32((m.ky * m.tx - m.sx * m.ty) * inv));
  if (!isFiniteNum(out.sx) || !isFiniteNum(out.kx) || !isFiniteNum(out.tx) || !isFiniteNum(out.ky) || !isFiniteNum(out.sy) || !isFiniteNum(out.ty)) return null;
  return out;
}

function isFiniteNum(v: number): boolean {
  return v === v && v !== 1 / 0 && v !== -1 / 0;
}

/** SkMatrix::Scale(sx, sy). */
function matScale(sx: number, sy: number): Mat {
  return mat(sx, 0, 0, 0, sy, 0);
}

/** setScale(sx, sy, px, py): identity for a unit scale. */
function matScalePivot(sx: number, sy: number, px: number, py: number): Mat {
  if (sx === 1 && sy === 1) return IDENTITY;
  return mat(sx, 0, f32(px - f32(sx * px)), 0, sy, f32(py - f32(sy * py)));
}

/** setSinCos(sin, cos, px, py). */
function matSinCos(sinV: number, cosV: number, px: number, py: number): Mat {
  const omc = f32(1 - cosV);
  return mat(cosV, -sinV, f32(f32(sinV * py) + f32(omc * px)), sinV, cosV, f32(f32(-sinV * px) + f32(omc * py)));
}

/** postTranslate for an affine matrix. */
function matPostTranslate(m: Mat, dx: number, dy: number): Mat {
  return mat(m.sx, m.kx, f32(m.tx + dx), m.ky, m.sy, f32(m.ty + dy));
}

/** Rect2Rect(src, dst, kFill), with each rect as float left, top, right, bottom; null when src is empty. */
function matRectToRect(sl: number, st: number, sr: number, sb: number, dl: number, dt: number, dr: number, db: number): Mat | null {
  if (!(sl < sr && st < sb)) return null;
  const sx = f32(f32(dr - dl) / f32(sr - sl));
  const sy = f32(f32(db - dt) / f32(sb - st));
  return mat(sx, 0, f32(dl - f32(sl * sx)), 0, sy, f32(dt - f32(st * sy)));
}

// ---------------------------------------------------------------------------------------------------------------------
// The CSS side: a gradient as the compiler hands it over (computed values; colours as 8-bit sRGB; lengths in CSS px).

/** An 8-bit legacy sRGB colour; alpha is 8-bit too, as Chrome keeps legacy colours (css/color.ts). */
export type StopColor = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };

/**
 * A <length-percentage> of the subset: a percentage, or CSS px (zoomed by the device scale at paint time). A position may also be
 * an offset from the right or bottom edge (end-percent, end-px; notes/T074-bg2-spec.md R7).
 */
export type LengthPct = { readonly unit: 'percent' | 'px' | 'end-percent' | 'end-px'; readonly value: number };

/** A colour stop: its colour and position ('auto' for a stop without one; two positions arrive as two stops). */
export type CssStop = { readonly color: StopColor; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };

/**
 * One gradient image. linear: direction 'default' (to bottom), 'angle' (angleDeg as Blink's ComputeDegrees, a double, and
 * slope, Blink's tan(float) of DegToRad(90 - the angle in [0, 360)) on the capture host, folded by the compiler), or 'side'
 * (sideX and sideY; a corner, both set, is not modelled). radial: circle or ellipse; extent a keyword or 'explicit' with
 * radiusX (and radiusY for an ellipse); centre as percentages or px (the computed value turns every keyword into a percentage).
 */
export type GradientImage = {
  readonly radial: boolean;
  readonly repeating: boolean;
  readonly direction: 'default' | 'angle' | 'side';
  readonly angleDeg: number;
  readonly slope: number;
  readonly sideX: 'none' | 'left' | 'right';
  readonly sideY: 'none' | 'top' | 'bottom';
  readonly circle: boolean;
  readonly extent: 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner' | 'explicit';
  readonly radiusX: LengthPct;
  readonly radiusY: LengthPct;
  readonly centerX: LengthPct;
  readonly centerY: LengthPct;
  readonly stops: readonly CssStop[];
};

/** Skia's colour of a stop: a float per channel (Blink Color::ToGradientStopSkColor4f of a legacy colour). */
export type Color4 = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

/** Blink's GradientDesc after AddStops: the points, radii and aspect, the spread method and the stops in [0, 1]. */
export type GradientDesc = {
  readonly radial: boolean;
  readonly repeat: boolean;
  readonly p0x: number;
  readonly p0y: number;
  readonly p1x: number;
  readonly p1y: number;
  readonly r0: number;
  readonly r1: number;
  readonly aspect: number;
  readonly offsets: readonly number[];
  readonly colors: readonly Color4[];
  /** False when Blink or Skia would draw nothing or a solid colour through a path this port does not model. */
  readonly modelled: boolean;
};

function stopColor4(c: StopColor): Color4 {
  return { r: f32(c.r / 255), g: f32(c.g / 255), b: f32(c.b / 255), a: f32(c.alpha / 255) };
}

/**
 * PositionFromValue for a computed centre coordinate: a percentage of the edge distance, or px times the zoom; from the right or
 * bottom edge, the edge distance less that.
 */
function positionOf(v: LengthPct, edge: number, zoom: number): number {
  if (v.unit === 'percent') return f32(f32(f32(v.value) / 100) * edge);
  if (v.unit === 'end-percent') return f32(edge - f32(f32(f32(v.value) / 100) * edge));
  if (v.unit === 'end-px') return f32(edge - f32(v.value * zoom));
  return f32(v.value * zoom);
}

/** ResolveRadius: px times the zoom, or a percentage of width or height, never negative. */
function radiusOf(v: LengthPct, basis: number, zoom: number): number {
  const r = v.unit === 'percent' ? f32(f32(basis * f32(v.value)) / 100) : f32(v.value * zoom);
  return maxNum(r, 0);
}

/** EndPointsFromAngle (css_gradient_value.cc:1249), for an unprefixed linear gradient, with its tan already taken (slope). */
function endPointsFromAngle(angle: number, slope: number, w: number, h: number): readonly number[] {
  let a = fmodF32(f32(angle), 360);
  if (a < 0) a = f32(a + 360);
  if (a === 0) return [0, h, 0, 0];
  if (a === 90) return [0, 0, w, 0];
  if (a === 180) return [0, 0, 0, h];
  if (a === 270) return [w, 0, 0, 0];
  const perp = f32(-1 / slope);
  const hh = f32(h / 2);
  const hw = f32(w / 2);
  let cx = -hw;
  let cy = hh;
  if (a < 90) {
    cx = hw;
    cy = hh;
  } else if (a < 180) {
    cx = hw;
    cy = -hh;
  } else if (a < 270) {
    cx = -hw;
    cy = -hh;
  }
  const c = f32(cy - f32(perp * cx));
  const ex = f32(c / f32(slope - perp));
  const ey = f32(f32(perp * ex) + c);
  return [f32(hw - ex), f32(hh + ey), f32(hw + ex), f32(hh - ey)];
}

/** RadiusToSide: the distances to the closest or farthest sides, as a circle or an ellipse. */
function radiusToSide(px: number, py: number, w: number, h: number, circle: boolean, closest: boolean): readonly number[] {
  const dx1 = absNum(px);
  const dy1 = absNum(py);
  const dx2 = absNum(f32(px - w));
  const dy2 = absNum(f32(py - h));
  const dx = closest ? (dx1 < dx2 ? dx1 : dx2) : dx1 > dx2 ? dx1 : dx2;
  const dy = closest ? (dy1 < dy2 ? dy1 : dy2) : dy1 > dy2 ? dy1 : dy2;
  if (circle) {
    const r = closest ? (dx < dy ? dx : dy) : dx > dy ? dx : dy;
    return [r, r];
  }
  return [dx, dy];
}

/** RadiusToCorner: the distance to the closest or farthest corner; an ellipse keeps the side radii's aspect ratio. */
function radiusToCorner(px: number, py: number, w: number, h: number, circle: boolean, closest: boolean): readonly number[] {
  const cxs = [0, w, w, 0];
  const cys = [0, 0, h, h];
  let best = 0;
  let dist = hypotF32(f32(px - 0), f32(py - 0));
  for (let i = 1; i < 4; i++) {
    const d = hypotF32(f32(px - (cxs[i] as number)), f32(py - (cys[i] as number)));
    if (closest ? d < dist : d > dist) {
      best = i;
      dist = d;
    }
  }
  if (circle) return [dist, dist];
  const side = radiusToSide(px, py, w, h, false, closest);
  const aspect = f32((side[0] as number) / (side[1] as number));
  if (!isFiniteNum(aspect) || aspect === 0) return [0, 0];
  const ox = f32((cxs[best] as number) - px);
  const oy = f32((cys[best] as number) - py);
  const a = sqrtF32(f32(f32(ox * ox) + f32(f32(f32(oy * oy) * aspect) * aspect)));
  return [a, f32(a / aspect)];
}

type ResolvedStop = { offset: number; color: Color4; specified: boolean };

/**
 * CreateGradient and AddStops (css_gradient_value.cc:646-827, 1338-1432, 1867-1964) for a tile of size w x h device px at
 * the given zoom (the device scale factor under zoom-for-DSF).
 */
export function gradientDesc(g: GradientImage, w: number, h: number, zoom: number): GradientDesc {
  let p0x = 0;
  let p0y = 0;
  let p1x = 0;
  let p1y = 0;
  let r1 = 0;
  let aspect = 1;
  let corner = false;
  if (!g.radial) {
    if (g.direction === 'angle') {
      const e = endPointsFromAngle(g.angleDeg, g.slope, w, h);
      p0x = e[0] as number;
      p0y = e[1] as number;
      p1x = e[2] as number;
      p1y = e[3] as number;
    } else if (g.direction === 'side' && g.sideX !== 'none' && g.sideY !== 'none') {
      // "Magic" corners: Blink takes the angle from atan2 and then tan of the box's size, libm calls on the capture host at
      // paint time; not modelled (the native targets refuse a corner, BG2b).
      corner = true;
      p1y = h;
    } else if (g.direction === 'side') {
      if (g.sideX !== 'none') {
        p1x = g.sideX === 'right' ? w : 0;
        p0x = f32(w - p1x);
      }
      if (g.sideY !== 'none') {
        p1y = g.sideY === 'bottom' ? h : 0;
        p0y = f32(h - p1y);
      }
    } else {
      p1y = h;
    }
  } else {
    const cx = positionOf(g.centerX, w, zoom);
    const cy = positionOf(g.centerY, h, zoom);
    p0x = cx;
    p0y = cy;
    p1x = cx;
    p1y = cy;
    let rx = 0;
    let ry = 0;
    if (g.extent === 'explicit') {
      rx = radiusOf(g.radiusX, w, zoom);
      ry = g.circle ? rx : radiusOf(g.radiusY, h, zoom);
    } else {
      const closest = g.extent === 'closest-side' || g.extent === 'closest-corner';
      const r = g.extent === 'closest-side' || g.extent === 'farthest-side' ? radiusToSide(cx, cy, w, h, g.circle, closest) : radiusToCorner(cx, cy, w, h, g.circle, closest);
      rx = r[0] as number;
      ry = r[1] as number;
    }
    const degenerate = rx === 0 || ry === 0;
    r1 = degenerate ? 0 : rx;
    aspect = degenerate ? 1 : f32(rx / ry);
  }
  // AddStops: resolve offsets against the gradient length, fix up monotonicity and spread unpositioned runs.
  const length = g.radial ? r1 : hypotF32(f32(p1x - p0x), f32(p1y - p0y));
  const n = g.stops.length;
  const stops: ResolvedStop[] = [];
  for (let i = 0; i < n; i++) {
    const s = g.stops[i] as CssStop;
    let offset = 0;
    let specified = false;
    if (s.unit === 'percent') {
      offset = f32(f32(s.value) / 100);
      specified = true;
    } else if (s.unit === 'px') {
      const len = f32(s.value * zoom);
      offset = length > 0 ? f32(len / length) : 0;
      specified = true;
    } else if (i === 0) {
      specified = true;
    } else if (n > 1 && i === n - 1) {
      offset = 1;
      specified = true;
    }
    if (specified && i > 0) {
      let prev = i - 1;
      while (prev > 0 && !(stops[prev] as ResolvedStop).specified) prev = prev - 1;
      const po = (stops[prev] as ResolvedStop).offset;
      if (offset < po) offset = po;
    }
    stops.push({ offset, color: stopColor4(s.color), specified });
  }
  if (n > 2) {
    let runStart = 0;
    let inRun = false;
    for (let i = 0; i < n; i++) {
      const s = stops[i] as ResolvedStop;
      if (!s.specified && !inRun) {
        runStart = i;
        inRun = true;
      } else if (s.specified && inRun) {
        const last = (stops[runStart - 1] as ResolvedStop).offset;
        const next = s.offset;
        const delta = f32(f32(next - last) / (i - runStart + 1));
        for (let j = runStart; j < i; j++) (stops[j] as ResolvedStop).offset = f32(last + f32((j - runStart + 1) * delta));
        inRun = false;
      }
    }
  }
  const first = (stops[0] as ResolvedStop).offset;
  const lastOffset = (stops[n - 1] as ResolvedStop).offset;
  const offsets: number[] = [];
  const colors: Color4[] = [];
  let modelled = !corner;
  const normalize = g.repeating || first < 0 || lastOffset > 1;
  if (!normalize) {
    for (const s of stops) {
      offsets.push(s.offset);
      colors.push(s.color);
    }
    return { radial: g.radial, repeat: g.repeating, p0x, p0y, p1x, p1y, r0: 0, r1, aspect, offsets, colors, modelled };
  }
  // A radial gradient that is not repeating clamps negative offsets with an interpolated colour; not modelled here.
  if (g.radial && !g.repeating && first < 0) modelled = false;
  const span = maxNum(f32(lastOffset - first), 0);
  let r0 = 0;
  if (span < 1.1920928955078125e-7) {
    const clamped = minNum(maxNum(first, 0), 1);
    if (!g.repeating) {
      offsets.push(clamped);
      colors.push((stops[0] as ResolvedStop).color);
    }
    offsets.push(clamped);
    colors.push((stops[n - 1] as ResolvedStop).color);
    if (g.radial && !g.repeating) {
      const rr = adjustRadii(r1, first, lastOffset);
      r0 = rr[0] as number;
      r1 = rr[1] as number;
    }
    // A single-offset stop list draws a solid colour or a degenerate gradient: not modelled here.
    return { radial: g.radial, repeat: g.repeating, p0x, p0y, p1x, p1y, r0, r1, aspect, offsets, colors, modelled: false };
  }
  for (const s of stops) {
    offsets.push(f32(f32(s.offset - first) / span));
    colors.push(s.color);
  }
  if (!g.radial) {
    const dx = f32(p1x - p0x);
    const dy = f32(p1y - p0y);
    const n0x = f32(p0x + f32(dx * first));
    const n0y = f32(p0y + f32(dy * first));
    const n1x = f32(p0x + f32(dx * lastOffset));
    const n1y = f32(p0y + f32(dy * lastOffset));
    p0x = n0x;
    p0y = n0y;
    p1x = n1x;
    p1y = n1y;
  } else {
    const rr = adjustRadii(r1, first, lastOffset);
    r0 = rr[0] as number;
    r1 = rr[1] as number;
  }
  return { radial: g.radial, repeat: g.repeating, p0x, p0y, p1x, p1y, r0, r1, aspect, offsets, colors, modelled };
}

/** AdjustGradientRadiiForOffsetRange: radii for the offset range, shifted positive by whole periods (repeating). */
function adjustRadii(r1: number, first: number, last: number): readonly number[] {
  let a0 = f32(r1 * first);
  let a1 = f32(r1 * last);
  if (a0 < 0) {
    const span = f32(a1 - a0);
    const shift = f32(span * -floorOf(f32(a0 / span)));
    a0 = f32(a0 + shift);
    a1 = f32(a1 + shift);
  }
  return [a0, a1];
}

// ---------------------------------------------------------------------------------------------------------------------
// Skia: the shader's stops (FillSkiaStops, the SkGradientBaseShader constructor), pts_to_unit and the gradient stages.

/** One stop stage: colour = factor * t + bias, premultiplied. */
export type StopStage = { readonly factor: Color4; readonly bias: Color4 };

/**
 * A compiled gradient shader without its device matrix: pts_to_unit composed later per cc tile. kind: 'two' is
 * evenly_spaced_2_stop_gradient, 'even' evenly_spaced_gradient, 'stops' gradient (arbitrary positions).
 */
export type GradientShader = {
  readonly radial: boolean;
  readonly repeat: boolean;
  readonly ptsToUnit: Mat;
  readonly local: Mat;
  readonly kind: 'two' | 'even' | 'stops';
  readonly clampT: boolean;
  readonly stages: readonly StopStage[];
  readonly ts: readonly number[];
  readonly opaque: boolean;
  /** SkConicalGradient's concentric case (a radial gradient whose start radius is not 0): t = mad(radius, scale, bias). */
  readonly concentric: boolean;
  readonly conicalScale: number;
  readonly conicalBias: number;
  /** Skia draws nothing (a degenerate or empty shader) or something this port does not model. */
  readonly drawable: boolean;
};

const ZERO4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
/** SkGradientBaseShader::kDegenerateThreshold, 2^-15. */
const DEGENERATE = 3.0517578125e-5;

function premul(c: Color4): Color4 {
  return { r: f32(c.r * c.a), g: f32(c.g * c.a), b: f32(c.b * c.a), a: c.a };
}

function sameColor(a: Color4, b: Color4): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function sub4(a: Color4, b: Color4): Color4 {
  return { r: f32(a.r - b.r), g: f32(a.g - b.g), b: f32(a.b - b.b), a: f32(a.a - b.a) };
}

function scale4(a: Color4, s: number): Color4 {
  return { r: f32(a.r * s), g: f32(a.g * s), b: f32(a.b * s), a: f32(a.a * s) };
}

/** The shader of a gradient descriptor drawn with local matrix `local` (Blink's RectToRect(src, dest)). */
export function gradientShader(d: GradientDesc, local: Mat, faults: GradientFaults): GradientShader {
  // Blink FillSkiaStops: pad a stop at 0 and at 1 with the end colours.
  const pos: number[] = [];
  const cols: Color4[] = [];
  const n = d.offsets.length;
  if ((d.offsets[0] as number) > 0) {
    pos.push(0);
    cols.push(d.colors[0] as Color4);
  }
  for (let i = 0; i < n; i++) {
    pos.push(d.offsets[i] as number);
    cols.push(d.colors[i] as Color4);
  }
  if ((pos[pos.length - 1] as number) < 1) {
    pos.push(1);
    cols.push(cols[cols.length - 1] as Color4);
  }
  let drawable = d.modelled;
  // pts_to_unit and the local matrix (Blink RadialGradient pre-scales an ellipse about its centre).
  let ptsToUnit = IDENTITY;
  let lm = local;
  let concentric = false;
  let conicalScale = 1;
  let conicalBias = 0;
  if (!d.radial) {
    const vx = f32(d.p1x - d.p0x);
    const vy = f32(d.p1y - d.p0y);
    const mag = sqrtF32(f32(f32(vx * vx) + f32(vy * vy)));
    if (absNum(mag) <= DEGENERATE) drawable = false;
    const inv = mag !== 0 ? f32(1 / mag) : 0;
    const ux = f32(vx * inv);
    const uy = f32(vy * inv);
    let m = matSinCos(-uy, ux, d.p0x, d.p0y);
    m = matPostTranslate(m, -d.p0x, -d.p0y);
    ptsToUnit = matConcat(matScale(inv, inv), m);
  } else {
    if (d.aspect !== 1) lm = matConcat(local, matScalePivot(1, f32(1 / d.aspect), d.p0x, d.p0y));
    const r0 = maxNum(d.r0, 0);
    const r1 = maxNum(d.r1, 0);
    // Skia TwoPointConicalGradient with equal centres: equal radii are degenerate (not modelled); a start radius of 0 is
    // SkRadialGradient; any other is SkConicalGradient's concentric case, scaled by 1 / max(r0, r1), then
    // t = mad(radius, max(r0, r1) / (r1 - r0), -r0 / (r1 - r0)) (SkConicalGradient::appendGradientStages).
    if (absNum(f32(r0 - r1)) <= DEGENERATE) drawable = false;
    if (absNum(r0) > DEGENERATE) {
      concentric = true;
      if (maxNum(r0, r1) <= 2.44140625e-4 || absNum(f32(r1 - r0)) <= 2.44140625e-4) drawable = false;
      const dr = f32(r1 - r0);
      conicalScale = f32(maxNum(r0, r1) / dr);
      conicalBias = f32(-r0 / dr);
    }
    const big = concentric ? maxNum(r0, r1) : r1;
    const inv = big !== 0 ? f32(1 / big) : 0;
    ptsToUnit = matConcat(matScale(inv, inv), mat(1, 0, -d.p0x, 0, 1, -d.p0y));
  }
  // SkGradientBaseShader: pin positions, detect uniform spacing (SkScalarNearlyEqual, 1/4096), dedupe repeated stops.
  const pinned: number[] = [0];
  let prev = 0;
  let uniform = true;
  const uniformStep = f32((pos[1] as number) - 0);
  for (let i = 1; i < pos.length; i++) {
    const curr = minNum(maxNum(pos[i] as number, prev), 1);
    if (absNum(f32(uniformStep - f32(curr - prev))) > 2.44140625e-4) uniform = false;
    pinned.push(curr);
    prev = curr;
  }
  let opaque = true;
  for (const c of cols) if (c.a !== 1) opaque = false;
  const pm: Color4[] = [];
  for (const c of cols) pm.push(faults.unpremultiplied ? c : premul(c));
  if (uniform) {
    if (pm.length === 2) {
      const l = pm[0] as Color4;
      const r = pm[1] as Color4;
      return { radial: d.radial, repeat: d.repeat, ptsToUnit, local: lm, kind: 'two', clampT: !d.repeat, stages: [{ factor: sub4(r, l), bias: l }], ts: [], opaque, concentric, conicalScale, conicalBias, drawable };
    }
    const gapCount = pm.length - 1;
    const stages: StopStage[] = [];
    for (let i = 0; i < gapCount; i++) {
      const l = pm[i] as Color4;
      const factor = scale4(sub4(pm[i + 1] as Color4, l), gapCount);
      const t = f32(i / gapCount);
      stages.push({ factor, bias: sub4(l, scale4(factor, t)) });
    }
    stages.push({ factor: ZERO4, bias: pm[gapCount] as Color4 });
    return { radial: d.radial, repeat: d.repeat, ptsToUnit, local: lm, kind: 'even', clampT: !d.repeat, stages, ts: [], opaque, concentric, conicalScale, conicalBias, drawable };
  }
  // Dedupe: of a run of equal positions keep the leftmost and, if repeated, the rightmost; a repeating shader drops a
  // leftmost duplicate at 0 and a rightmost at 1.
  const dPos: number[] = [];
  const dCol: Color4[] = [];
  let i0 = 0;
  for (let j = 1; j <= pinned.length; j++) {
    if (j === pinned.length || (pinned[i0] as number) !== (pinned[j] as number)) {
      const dup = j - i0 > 1;
      const ignoreLeft = dup && d.repeat && (pinned[i0] as number) === 0;
      if (!ignoreLeft) {
        dPos.push(pinned[i0] as number);
        dCol.push(pm[i0] as Color4);
      }
      const ignoreRight = d.repeat && (pinned[j - 1] as number) === 1;
      if (dup && !ignoreRight) {
        dPos.push(pinned[j - 1] as number);
        dCol.push(pm[j - 1] as Color4);
      }
      i0 = j;
    }
  }
  const count = dPos.length;
  let firstStop = 0;
  let lastStop = 1;
  if (count > 2) {
    firstStop = sameColor(dCol[0] as Color4, dCol[1] as Color4) ? 1 : 0;
    lastStop = sameColor(dCol[count - 2] as Color4, dCol[count - 1] as Color4) ? count - 2 : count - 1;
  }
  const stages: StopStage[] = [];
  const ts: number[] = [0];
  let tL = dPos[firstStop] as number;
  let cL = dCol[firstStop] as Color4;
  stages.push({ factor: ZERO4, bias: cL });
  for (let i = firstStop; i < lastStop; i++) {
    const tR = dPos[i + 1] as number;
    const cR = dCol[i + 1] as Color4;
    if (tL < tR) {
      const cScale = f32(1 / f32(tR - tL));
      if (isFiniteNum(cScale)) {
        const factor = scale4(sub4(cR, cL), cScale);
        ts.push(tL);
        stages.push({ factor, bias: sub4(cL, scale4(factor, tL)) });
      }
    }
    tL = tR;
    cL = cR;
  }
  ts.push(tL);
  stages.push({ factor: ZERO4, bias: cL });
  return { radial: d.radial, repeat: d.repeat, ptsToUnit, local: lm, kind: 'stops', clampT: false, stages, ts, opaque, concentric, conicalScale, conicalBias, drawable };
}

/**
 * MatrixRec::apply on a cc raster tile whose bitmap starts at (tileX, tileY): the CTM is translate(-tileX, -tileY), the
 * total is Concat(ptsToUnit, invert(Concat(CTM, local))); null when that inverse does not exist.
 */
export function tileMatrix(s: GradientShader, tileX: number, tileY: number): Mat | null {
  const inv = matInvert(matConcat(mat(1, 0, -tileX, 0, 1, -tileY), s.local));
  if (inv === null) return null;
  return matConcat(s.ptsToUnit, inv);
}

/**
 * One device pixel of a gradient over dst (8-bit premultiplied RGBA in [r, g, b, a]), at page device pixel (x, y) in the
 * tile starting at (tileX, tileY) whose total matrix is m: seed_shader, the matrix stage appendMatrix picks, xy_to_radius
 * (radial), the tile mode, the stop stage, dither, clamp and srcover, then store_8888. Returns [r, g, b, a].
 */
export function shadePixel(s: GradientShader, m: Mat, x: number, y: number, tileX: number, tileY: number, dst: readonly number[], faults: GradientFaults): readonly number[] {
  const fx = x - tileX + 0.5;
  const fy = y - tileY + 0.5;
  const type = matType(m);
  let r = fx;
  let g = fy;
  if (type === 1) {
    r = f32(fx + m.tx);
    g = f32(fy + m.ty);
  } else if (type > 1 && type < 4) {
    r = fma32(fx, m.sx, m.tx);
    g = fma32(fy, m.sy, m.ty);
  } else if (type >= 4) {
    r = fma32(fx, m.sx, fma32(fy, m.kx, m.tx));
    g = fma32(fx, m.ky, fma32(fy, m.sy, m.ty));
  }
  let t = r;
  if (s.radial) t = sqrtF32(f32(f32(r * r) + f32(g * g)));
  if (s.concentric) t = fma32(t, s.conicalScale, s.conicalBias);
  if (s.repeat) t = minNum(maxNum(0, f32(t - floorOf(t))), 1);
  else if (s.clampT) t = minNum(maxNum(0, t), 1);
  let idx = 0;
  if (s.kind === 'even') idx = truncOf(f32(t * (s.stages.length - 1)));
  if (s.kind === 'stops') for (let i = 1; i < s.ts.length; i++) if (t >= (s.ts[i] as number)) idx = idx + 1;
  const st = s.stages[idx] as StopStage;
  let cr = fma32(t, st.factor.r, st.bias.r);
  let cg = fma32(t, st.factor.g, st.bias.g);
  let cb = fma32(t, st.factor.b, st.bias.b);
  let ca = fma32(t, st.factor.a, st.bias.a);
  if (faults.unpremultiplied && !s.opaque) {
    cr = f32(cr * ca);
    cg = f32(cg * ca);
    cb = f32(cb * ca);
  }
  if (!faults.ditherOff) {
    const d = ditherOffset(x - tileX, y - tileY);
    cr = maxNum(0, minNum(fma32(d, RATE_8888, cr), ca));
    cg = maxNum(0, minNum(fma32(d, RATE_8888, cg), ca));
    cb = maxNum(0, minNum(fma32(d, RATE_8888, cb), ca));
  }
  cr = minNum(maxNum(0, cr), 1);
  cg = minNum(maxNum(0, cg), 1);
  cb = minNum(maxNum(0, cb), 1);
  ca = minNum(maxNum(0, ca), 1);
  if (!s.opaque) {
    const inv = f32(1 - ca);
    cr = fma32(f32((dst[0] as number) * INV_255), inv, cr);
    cg = fma32(f32((dst[1] as number) * INV_255), inv, cg);
    cb = fma32(f32((dst[2] as number) * INV_255), inv, cb);
    ca = fma32(f32((dst[3] as number) * INV_255), inv, ca);
  }
  return [toUnorm(cr), toUnorm(cg), toUnorm(cb), toUnorm(ca)];
}

const RATE_8888 = 0.003921568859368563;
const INV_255 = 0.003921568859368563;

/** store_8888's to_unorm(v, 255): round(min(max(0, mad(v, 255, 0)), 255)). */
function toUnorm(v: number): number {
  return roundHalfEven(minNum(maxNum(0, fma32(v, 255, 0)), 255));
}


// ---------------------------------------------------------------------------------------------------------------------
// Blink background tile geometry (background_image_geometry.cc Calculate for a normal box, box_painter_base.cc
// OptimizeToSingleTileDraw and the padding/content clip) in LayoutUnit raw values (1/64 device px under zoom-for-DSF).

/** A box as the background painter sees it: the absolute border box and its borders and padding, all raw LU. */
export type BackgroundBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Border widths, top, right, bottom, left (whole device px as LU). */
  readonly borders: readonly number[];
  /** Padding, top, right, bottom, left. */
  readonly padding: readonly number[];
  /** Whether each border side hides the background under it (BorderEdge::ObscuresBackground), top, right, bottom, left. */
  readonly obscures: readonly boolean[];
};

export type BoxKeyword = 'border-box' | 'padding-box' | 'content-box';
/** background-repeat per axis; space and round are refused at build time (BG2c). */
export type RepeatKeyword = 'repeat' | 'no-repeat';
/** A background-size component: auto, or a <length-percentage>; cover and contain set both. */
export type SizeComponent = { readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };

/** One background layer's computed geometry. */
export type LayerGeometry = {
  readonly sizeKind: 'length' | 'cover' | 'contain';
  readonly sizeX: SizeComponent;
  readonly sizeY: SizeComponent;
  readonly positionX: LengthPct;
  readonly positionY: LengthPct;
  readonly repeatX: RepeatKeyword;
  readonly repeatY: RepeatKeyword;
  readonly origin: BoxKeyword;
  readonly clip: BoxKeyword;
};

/**
 * Where one layer draws: the snapped dest rect (raw LU; whole device px unless a no-repeat axis gives it a tile-sized
 * extent), the clip rect (whole device px), the tile size and the dest's offset in the tile (raw LU), and whether Chrome
 * draws it as one tile (OptimizeToSingleTileDraw succeeds). Only single-tile draws are modelled; a layer that must tile
 * is refused at build time and flagged here at run time.
 */
export type LayerPlacement = {
  readonly destX: number;
  readonly destY: number;
  readonly destWidth: number;
  readonly destHeight: number;
  readonly clipLeft: number;
  readonly clipTop: number;
  readonly clipRight: number;
  readonly clipBottom: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly srcX: number;
  readonly srcY: number;
  /** One tile covers the snapped dest: Chrome's result is one copy of the tile (directly drawn or through the picture shader). */
  readonly singleTile: boolean;
  /**
   * Chrome draws the layer directly (the gradient shader on the page's cc raster tile); otherwise it draws the tile through
   * the picture shader, whose tile image has its own origin (the dither and the shader matrix start at the tile).
   */
  readonly direct: boolean;
};

const LU_MAX = 2147483647;
const LU_MIN = -2147483648;

function luSat(v: number): number {
  if (v !== v) return 0;
  if (v > LU_MAX) return LU_MAX;
  if (v < LU_MIN) return LU_MIN;
  return v;
}

/** LayoutUnit(float): saturated_cast<int>(value * 64) with the product in float. */
function luFromFloat(v: number): number {
  return luSat(truncOf(f32(f32(v) * 64)));
}

/** LayoutUnit::Round in whole units: floor((raw + 32) / 64). */
function luRound(raw: number): number {
  return floorOf((raw + 32) / 64);
}

/** IntMod: raw % raw with the dividend's sign. */
function luMod(a: number, b: number): number {
  return a - truncOf(a / b) * b;
}

/** LayoutUnit::ToFloat. */
function luFloat(raw: number): number {
  return f32(raw / 64);
}

/**
 * MinimumValueForLength for a zoomed px length or a percentage of `available` (units.ts percentOf). An edge offset is Blink's
 * SubtractFromOneHundredPercent: a percentage p becomes 100 - p, and px becomes calc(100% - px), evaluated by CalculationValue as
 * pixels + percent / 100 * available in float.
 */
function luLength(v: LengthPct, available: number, zoom: number): number {
  if (v.unit === 'percent' || v.unit === 'end-percent') {
    const pct = v.unit === 'percent' ? f32(v.value) : f32(100 - f32(v.value));
    const product = f32(luFloat(available) * pct);
    return luFromFloat(f32(product / 100));
  }
  if (v.unit === 'end-px') return luFromFloat(f32(-f32(v.value * zoom) + luFloat(available)));
  return luFromFloat(f32(v.value * zoom));
}

/** ToPixelSnappedRect of a raw LU rect, as whole device px [left, top, right, bottom]. */
function snapLtrb(x: number, y: number, w: number, h: number): readonly number[] {
  return [luRound(x), luRound(y), luRound(x + w), luRound(y + h)];
}

/**
 * One axis of CalculateRepeatAndPosition for repeat or no-repeat: [phase, unsnapped dest size, snapped dest offset, snapped
 * dest size], raw LU. destStart is the unsnapped dest offset; snappedStart and snappedSize the snapped dest's.
 */
function placeAxis(repeat: RepeatKeyword, position: LengthPct, tile: number, area: number, snappedArea: number, boxOffset: number, snappedBoxOffset: number, destStart: number, destSize: number, snappedStart: number, snappedSize: number, zoom: number): readonly number[] {
  if (repeat === 'repeat') {
    const offset = luLength(position, area - tile, zoom);
    const phase = tile !== 0 ? tile - luMod(boxOffset + offset, tile) : 0;
    return [phase, destSize, snappedStart, snappedSize];
  }
  const x = boxOffset + luLength(position, area - tile, zoom);
  const sx = snappedBoxOffset + luLength(position, snappedArea - tile, zoom);
  if (x > 0) return [0, tile, luRound(destStart + x) * 64, tile];
  return [-x, tile + x, snappedStart, tile + sx];
}

function isZeroStrut(p: readonly number[]): boolean {
  return (p[0] as number) === 0 && (p[1] as number) === 0 && (p[2] as number) === 0 && (p[3] as number) === 0;
}

/** The snapped outsets of a box keyword: the unsnapped ones for a content box with padding, the inner border otherwise. */
function snappedOutsetsOf(k: BoxKeyword, box: BackgroundBox, inner: readonly number[]): readonly number[] {
  if (k === 'content-box' && !isZeroStrut(box.padding)) return outsetsOf(k, box);
  if (k === 'border-box') return [0, 0, 0, 0];
  return inner;
}

/** The borders and padding a box keyword contracts the border box by, unsnapped: [top, right, bottom, left]. */
function outsetsOf(k: BoxKeyword, box: BackgroundBox): readonly number[] {
  const b = box.borders;
  const p = box.padding;
  if (k === 'content-box' && !isZeroStrut(p)) return [(b[0] as number) + (p[0] as number), (b[1] as number) + (p[1] as number), (b[2] as number) + (p[2] as number), (b[3] as number) + (p[3] as number)];
  if (k === 'border-box') return [0, 0, 0, 0];
  return [b[0] as number, b[1] as number, b[2] as number, b[3] as number];
}

/** Whether one tile at the dest offset plus the (non-positive) phase holds a dest of size w x h (PhysicalRect::Contains). */
function tileHolds(phaseX: number, phaseY: number, tileW: number, tileH: number, w: number, h: number): boolean {
  return phaseX <= 0 && phaseY <= 0 && phaseX + tileW >= w && phaseY + tileH >= h;
}

/**
 * The placement of one layer in a box at a zoom (the device scale factor). bottom: the layer is the bottom layer of the box's
 * list (Blink's fast path draws a bottom border-box layer against the snapped dest).
 */
export function layerPlacement(box: BackgroundBox, g: LayerGeometry, zoom: number, bottom: boolean, faults: GradientFaults): LayerPlacement {
  const b = box.borders;
  const p = box.padding;
  const snappedBox = snapLtrb(box.x, box.y, box.width, box.height);
  // PixelSnappedContouredInnerBorder: the snapped border box inset by the whole-device-px borders; its outsets from the
  // unsnapped border box (InnerBorderOutsets), [top, right, bottom, left].
  const inner = [(snappedBox[1] as number) * 64 + (b[0] as number) - box.y, box.x + box.width - ((snappedBox[2] as number) * 64 - (b[1] as number)), box.y + box.height - ((snappedBox[3] as number) * 64 - (b[2] as number)), (snappedBox[0] as number) * 64 + (b[3] as number) - box.x];
  // ComputeDestRectAdjustments: the clip box; a border-box clip drops each border side that obscures the background.
  let du = outsetsOf(g.clip, box);
  let ds = snappedOutsetsOf(g.clip, box, inner);
  if (g.clip === 'border-box') {
    const o = faults.obscuredBorderIgnored ? [false, false, false, false] : box.obscures;
    const ot = o[0] as boolean;
    const or = o[1] as boolean;
    const ob = o[2] as boolean;
    const ol = o[3] as boolean;
    du = [ot ? (b[0] as number) : 0, or ? (b[1] as number) : 0, ob ? (b[2] as number) : 0, ol ? (b[3] as number) : 0];
    ds = [ot ? (inner[0] as number) : 0, or ? (inner[1] as number) : 0, ob ? (inner[2] as number) : 0, ol ? (inner[3] as number) : 0];
  }
  // ComputePositioningAreaAdjustments: the origin box.
  const ou = outsetsOf(g.origin, box);
  const os = snappedOutsetsOf(g.origin, box, inner);
  const sd = snapLtrb(box.x + (ds[3] as number), box.y + (ds[0] as number), box.width - (ds[3] as number) - (ds[1] as number), box.height - (ds[0] as number) - (ds[2] as number));
  const sp = snapLtrb(box.x + (os[3] as number), box.y + (os[0] as number), box.width - (os[3] as number) - (os[1] as number), box.height - (os[0] as number) - (os[2] as number));
  const snappedAreaW = maxNum(0, ((sp[2] as number) - (sp[0] as number)) * 64);
  const snappedAreaH = maxNum(0, ((sp[3] as number) - (sp[1] as number)) * 64);
  const areaW = maxNum(0, box.width - (ou[3] as number) - (ou[1] as number));
  const areaH = maxNum(0, box.height - (ou[0] as number) - (ou[2] as number));
  // CalculateFillTileSize for an image without a natural size: the snapped positioning area, or explicit components.
  let tileW = snappedAreaW;
  let tileH = snappedAreaH;
  if (g.sizeKind === 'length') {
    if (g.sizeX.unit === 'px') tileW = luFromFloat(f32(g.sizeX.value * zoom));
    else if (g.sizeX.unit === 'percent') tileW = luLength({ unit: 'percent', value: g.sizeX.value }, snappedAreaW, zoom);
    if (g.sizeY.unit === 'px') tileH = luFromFloat(f32(g.sizeY.value * zoom));
    else if (g.sizeY.unit === 'percent') tileH = luLength({ unit: 'percent', value: g.sizeY.value }, snappedAreaH, zoom);
    tileW = maxNum(0, tileW);
    tileH = maxNum(0, tileH);
  }
  const ax = placeAxis(g.repeatX, g.positionX, tileW, areaW, snappedAreaW, (ou[3] as number) - (du[3] as number), (os[3] as number) - (ds[3] as number), box.x + (du[3] as number), maxNum(0, box.width - (du[3] as number) - (du[1] as number)), (sd[0] as number) * 64, maxNum(0, ((sd[2] as number) - (sd[0] as number)) * 64), zoom);
  const ay = placeAxis(g.repeatY, g.positionY, tileH, areaH, snappedAreaH, (ou[0] as number) - (du[0] as number), (os[0] as number) - (ds[0] as number), box.y + (du[0] as number), maxNum(0, box.height - (du[0] as number) - (du[2] as number)), (sd[1] as number) * 64, maxNum(0, ((sd[3] as number) - (sd[1] as number)) * 64), zoom);
  // ComputePhase, then OptimizeToSingleTileDraw: one tile at the snapped dest offset plus the phase must hold the dest at its
  // unsnapped size (DrawTiledBackground), or at its snapped size for a bottom border-box layer that fits the tile
  // (PaintFastBottomLayer). A dest that one tile holds at its snapped size only is drawn through the picture shader: the
  // result is still one tile, rastered in the tile's own space.
  const phaseX = tileW !== 0 ? luMod(-(ax[0] as number), tileW) : 0;
  const phaseY = tileH !== 0 ? luMod(-(ay[0] as number), tileH) : 0;
  const sdx = ax[2] as number;
  const sdy = ay[2] as number;
  const single = tileHolds(phaseX, phaseY, tileW, tileH, ax[3] as number, ay[3] as number);
  const fast = bottom && g.clip === 'border-box' && tileW >= (ax[3] as number) && tileH >= (ay[3] as number);
  const blinkDirect = fast ? single : tileHolds(phaseX, phaseY, tileW, tileH, ax[1] as number, ay[1] as number);
  const direct = faults.singleTileModelSwapped && single ? !blinkDirect : blinkDirect;
  // The clip of a padding-box or content-box layer: the border box contracted by borders (and padding), snapped.
  let clip = snappedBox;
  if (g.clip !== 'border-box') {
    const o = g.clip === 'content-box' ? [(b[0] as number) + (p[0] as number), (b[1] as number) + (p[1] as number), (b[2] as number) + (p[2] as number), (b[3] as number) + (p[3] as number)] : [b[0] as number, b[1] as number, b[2] as number, b[3] as number];
    clip = snapLtrb(box.x + (o[3] as number), box.y + (o[0] as number), box.width - (o[3] as number) - (o[1] as number), box.height - (o[0] as number) - (o[2] as number));
  }
  return {
    destX: sdx,
    destY: sdy,
    destWidth: maxNum(0, ax[3] as number),
    destHeight: maxNum(0, ay[3] as number),
    clipLeft: clip[0] as number,
    clipTop: clip[1] as number,
    clipRight: clip[2] as number,
    clipBottom: clip[3] as number,
    tileWidth: tileW,
    tileHeight: tileH,
    srcX: 0 - phaseX,
    srcY: 0 - phaseY,
    singleTile: single,
    direct,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// A box's background: the colour and every gradient layer, composited bottom layer first over transparent, row by row.

/** One background layer: its geometry and its gradient. */
export type BackgroundLayer = { readonly geometry: LayerGeometry; readonly image: GradientImage };

/**
 * A box's background paint: its box, its background colour (painted in the bottom layer's clip area) and its gradient
 * layers in CSS order (the first is on top), at a zoom, on a Chrome whose cc raster tiles are tileSize device px.
 */
export type BackgroundPaint = {
  readonly box: BackgroundBox;
  readonly color: StopColor;
  /** The bottom layer's background-clip, which clips the colour (a bottom layer without an image is not in layers). */
  readonly colorClip: BoxKeyword;
  readonly layers: readonly BackgroundLayer[];
  /** Whether the last of layers is the box's bottom layer (false when the bottom layer's image is none). */
  readonly lastIsBottom: boolean;
  readonly zoom: number;
  readonly tileSize: number;
  /**
   * The origin of the box's composited layer in page device px (whole px): the root scroller's (0, 0), or the box's own border
   * box when it is composited (notes/T074-bg2-spec.md R4). Chrome rasters the layer in its own space, so the cc tiles, the
   * dither and every shader matrix start there.
   */
  readonly layerX: number;
  readonly layerY: number;
};

/**
 * One planned layer: where it draws and its shader. A layer Chrome draws through the picture shader (placement.direct false)
 * has its shader in the tile's own space (local matrix identity), and its tile starts at device px (tileX, tileY).
 */
export type PlannedLayer = { readonly placement: LayerPlacement; readonly shader: GradientShader; readonly tileX: number; readonly tileY: number };

/**
 * The raster plan of a background: the snapped border box (whole page device px), the colour's area and the layers bottom
 * first (in the layer's own device px, from originX and originY), and whether every layer is a single-tile draw of a modelled
 * shader (a build-time guarantee the device checks).
 */
export type BackgroundPlan = {
  readonly originX: number;
  readonly originY: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly color: readonly number[];
  readonly colorLeft: number;
  readonly colorTop: number;
  readonly colorRight: number;
  readonly colorBottom: number;
  readonly layers: readonly PlannedLayer[];
  readonly tileSize: number;
  readonly modelled: boolean;
};

/** Plans a background: each layer's placement, its gradient at the tile size, and its shader with the dest local matrix. */
export function planBackground(bg: BackgroundPaint, faults: GradientFaults): BackgroundPlan {
  const ox = faults.layerOriginIgnored ? 0 : bg.layerX;
  const oy = faults.layerOriginIgnored ? 0 : bg.layerY;
  if (floorOf(ox) !== ox || floorOf(oy) !== oy) return { originX: 0, originY: 0, left: 0, top: 0, right: 0, bottom: 0, color: [0, 0, 0, 0], colorLeft: 0, colorTop: 0, colorRight: 0, colorBottom: 0, layers: [], tileSize: bg.tileSize, modelled: false };
  // The box in its layer's space: whole device px moves keep every snap (LayoutUnit rounding is translation-exact in 64ths).
  const box: BackgroundBox = { x: bg.box.x - ox * 64 + (faults.offsetOne ? 64 : 0), y: bg.box.y - oy * 64, width: bg.box.width, height: bg.box.height, borders: bg.box.borders, padding: bg.box.padding, obscures: bg.box.obscures };
  const snapped = snapLtrb(box.x, box.y, box.width, box.height);
  const layers: PlannedLayer[] = [];
  let modelled = true;
  for (let i = bg.layers.length - 1; i >= 0; i--) {
    const layer = bg.layers[i] as BackgroundLayer;
    const pl = layerPlacement(box, layer.geometry, bg.zoom, bg.lastIsBottom && i === bg.layers.length - 1, faults);
    if (!pl.singleTile) modelled = false;
    const w = luFloat(pl.tileWidth);
    const h = luFloat(pl.tileHeight);
    if (!(w > 0 && h > 0) || pl.destWidth <= 0 || pl.destHeight <= 0) continue;
    const desc = gradientDesc(layer.image, w, h, bg.zoom);
    // GradientGeneratedImage::Draw: RectToRect(src, dest), both as SkRects built from x, y, width, height floats.
    const sl = luFloat(pl.srcX);
    const st = luFloat(pl.srcY);
    const dl = luFloat(pl.destX);
    const dt = luFloat(pl.destY);
    const lm = matRectToRect(sl, st, f32(sl + luFloat(pl.destWidth)), f32(st + luFloat(pl.destHeight)), dl, dt, f32(dl + luFloat(pl.destWidth)), f32(dt + luFloat(pl.destHeight)));
    if (lm === null) continue;
    // The picture shader's tile image: GeneratedImage::DrawTile draws the gradient over the image's own bounds (local matrix
    // identity); DrawPattern places it at the snapped dest offset plus the phase, a whole device px for a single tile.
    const tileX = pl.destX - pl.srcX;
    const tileY = pl.destY - pl.srcY;
    if (!pl.direct && (tileX - floorOf(tileX / 64) * 64 !== 0 || tileY - floorOf(tileY / 64) * 64 !== 0)) modelled = false;
    const shader = gradientShader(desc, pl.direct ? lm : IDENTITY, faults);
    if (!shader.drawable) modelled = false;
    layers.push({ placement: pl, shader, tileX: floorOf(tileX / 64), tileY: floorOf(tileY / 64) });
  }
  let colorArea = snapped;
  if (bg.colorClip !== 'border-box') {
    const b = box.borders;
    const p = box.padding;
    const o = bg.colorClip === 'content-box' ? [(b[0] as number) + (p[0] as number), (b[1] as number) + (p[1] as number), (b[2] as number) + (p[2] as number), (b[3] as number) + (p[3] as number)] : [b[0] as number, b[1] as number, b[2] as number, b[3] as number];
    colorArea = snapLtrb(box.x + (o[3] as number), box.y + (o[0] as number), box.width - (o[3] as number) - (o[1] as number), box.height - (o[0] as number) - (o[2] as number));
  }
  const c = premul(stopColor4(bg.color));
  return {
    originX: ox,
    originY: oy,
    left: (snapped[0] as number) + ox,
    top: (snapped[1] as number) + oy,
    right: (snapped[2] as number) + ox,
    bottom: (snapped[3] as number) + oy,
    color: [toUnorm(c.r), toUnorm(c.g), toUnorm(c.b), toUnorm(c.a)],
    colorLeft: colorArea[0] as number,
    colorTop: colorArea[1] as number,
    colorRight: colorArea[2] as number,
    colorBottom: colorArea[3] as number,
    layers,
    tileSize: bg.tileSize,
    modelled,
  };
}

/** Whether device pixel (x, y) is inside a layer's drawn area: its dest rect (pixel centre) and its clip rect. */
function inLayer(pl: LayerPlacement, x: number, y: number): boolean {
  const cx = x * 64 + 32;
  const cy = y * 64 + 32;
  return x >= pl.clipLeft && x < pl.clipRight && y >= pl.clipTop && y < pl.clipBottom && cx >= pl.destX && cx < pl.destX + pl.destWidth && cy >= pl.destY && cy < pl.destY + pl.destHeight;
}

/**
 * Whether the reference's value at page device pixel (x, y) is Chrome's exactly: false where a layer's dest edge is fractional
 * and crosses the pixel (Skia anti-aliases that edge; the lanes' edge rule covers it).
 */
export function backgroundPixelExact(plan: BackgroundPlan, px: number, py: number): boolean {
  const x = px - plan.originX;
  const y = py - plan.originY;
  for (const l of plan.layers) {
    const p = l.placement;
    const edges = [p.destX, p.destX + p.destWidth];
    for (const e of edges) if (e - floorOf(e / 64) * 64 !== 0 && floorOf(e / 64) === x && y >= p.clipTop && y < p.clipBottom) return false;
    const vedges = [p.destY, p.destY + p.destHeight];
    for (const e of vedges) if (e - floorOf(e / 64) * 64 !== 0 && floorOf(e / 64) === y && x >= p.clipLeft && x < p.clipRight) return false;
  }
  return true;
}

/**
 * One row of the background's raster at page device row py, x from plan.left to plan.right: premultiplied 8-bit [r, g, b, a]
 * per pixel; pixels no layer draws are 0, 0, 0, 0 (the native background colour shows there). Inside a layer's area the colour
 * and the layers are composited bottom first exactly as Skia composites them onto the layer's cc tiles.
 */
export function backgroundRow(plan: BackgroundPlan, py: number, faults: GradientFaults): readonly number[] {
  const out: number[] = [];
  const ts = plan.tileSize;
  const y = py - plan.originY;
  const tileY = ccTileStart(ccTileIndex(y, ts), ts);
  let tileX = -1;
  let mats: Mat[] = [];
  let valid: boolean[] = [];
  for (let x = plan.left - plan.originX; x < plan.right - plan.originX; x++) {
    let any = false;
    for (const l of plan.layers) if (inLayer(l.placement, x, y)) any = true;
    if (!any) {
      out.push(0);
      out.push(0);
      out.push(0);
      out.push(0);
      continue;
    }
    const tx = ccTileStart(ccTileIndex(x, ts), ts);
    if (tx !== tileX) {
      tileX = tx;
      mats = [];
      valid = [];
      for (const l of plan.layers) {
        const m = tileMatrix(l.shader, tileX, tileY);
        mats.push(m === null ? IDENTITY : m);
        valid.push(m !== null);
      }
    }
    let dst: readonly number[] = [0, 0, 0, 0];
    if (x >= plan.colorLeft && x < plan.colorRight && y >= plan.colorTop && y < plan.colorBottom) dst = plan.color;
    for (let i = 0; i < plan.layers.length; i++) {
      const l = plan.layers[i] as PlannedLayer;
      if (!inLayer(l.placement, x, y)) continue;
      if (!l.placement.direct) {
        // The tile image pixel (over transparent, dithered from the tile's origin), then the image shader over dst.
        const m = tileMatrix(l.shader, 0, 0);
        if (m === null) continue;
        dst = imageSrcOver(shadePixel(l.shader, m, x - l.tileX, y - l.tileY, 0, 0, CLEAR, faults), dst);
        continue;
      }
      if (!(valid[i] as boolean)) continue;
      dst = shadePixel(l.shader, mats[i] as Mat, x, y, tileX, tileY, dst, faults);
    }
    out.push(dst[0] as number);
    out.push(dst[1] as number);
    out.push(dst[2] as number);
    out.push(dst[3] as number);
  }
  return out;
}

const CLEAR: readonly number[] = [0, 0, 0, 0];

/**
 * An 8-bit premultiplied image pixel drawn over dst by the raster pipeline without dither: from_byte (v * (1/255) in float),
 * srcover (mad(d, 1 - a, s)) and store_8888.
 */
function imageSrcOver(src: readonly number[], dst: readonly number[]): readonly number[] {
  const a = f32((src[3] as number) * INV_255);
  const inv = f32(1 - a);
  const r = fma32(f32((dst[0] as number) * INV_255), inv, f32((src[0] as number) * INV_255));
  const g = fma32(f32((dst[1] as number) * INV_255), inv, f32((src[1] as number) * INV_255));
  const b = fma32(f32((dst[2] as number) * INV_255), inv, f32((src[2] as number) * INV_255));
  const al = fma32(f32((dst[3] as number) * INV_255), inv, a);
  return [toUnorm(r), toUnorm(g), toUnorm(b), toUnorm(al)];
}

/** The cc raster tile size Chrome 145 uses on the capture host (macOS, device scale factor 2 or more): ccTileSize. */
export function referenceTileSize(zoom: number): number {
  return ccTileSize(true, zoom);
}
