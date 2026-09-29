// CSS linear-gradient pixels as Chrome 145 rasters them on the CPU (arm64): Blink's stop list (gradient.cc FillSkiaStops,
// css_gradient_value.cc EndPointsFromAngle), Skia 2ab8add5's SkGradientBaseShader stop setup
// (src/shaders/gradients/SkGradientBaseShader.cpp:183-500), pts_to_unit_matrix and the SkMatrix concat/invert that feed
// matrix_scale_translate, and the highp raster pipeline stages (src/opts/SkRasterPipeline_opts.h: seed_shader :2069,
// dither :2085-2117, gradient stages :3542-3566, clamp_01, srcover, store_8888) with NEON's fused mad and
// round-to-nearest-even stores. The dither's (dx, dy) are relative to the cc raster tile. Reference only: no engine root.
import { floorOf, froundOf, truncOf } from './rt-easing.ts';

/** Planted faults (T109); the Chrome pixel oracle must catch each one. */
export type DitherFaults = {
  readonly ditherDisabled: boolean;
  readonly ditherPhaseShift: boolean;
  readonly gradientUnpremultiplied: boolean;
};

export const NO_DITHER_FAULTS: DitherFaults = { ditherDisabled: false, ditherPhaseShift: false, gradientUnpremultiplied: false };

/** An 8-bit sRGB color, as a legacy CSS color stores it. */
export type Rgba8 = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

/** One sorted gradient stop: its offset as a fraction (the CSS percentage / 100) and color. */
export type GradientStop = { readonly offset: number; readonly color: Rgba8 };

/**
 * A `linear-gradient(to right | to bottom, ...)` background filling a box whose painted rect is dest (integer device px):
 * Blink's endpoints are (0, 0) to (width, 0) or (0, height), and the local matrix is RectToRect(image, dest).
 */
export type LinearGradientSpec = {
  readonly destLeft: number;
  readonly destTop: number;
  readonly width: number;
  readonly height: number;
  readonly axis: 'x' | 'y';
  readonly stops: readonly GradientStop[];
  /** cc's raster tile size in device px (ccTileSize). */
  readonly tileSize: number;
};

const CC_BORDER_TEXELS = 1;

/**
 * cc's default raster tile size (Blink layer_tree_settings.cc:263-292): 512 on Mac and ChromeOS at a device scale factor of
 * 2 or more, otherwise 256 (Android sizes by screen area). A layer at least this big both ways uses square tiles of it
 * (cc/layers/tile_size_calculator.cc:216-237).
 */
export function ccTileSize(macOrChromeOs: boolean, deviceScaleFactor: number): number {
  return macOrChromeOs && deviceScaleFactor >= 2 ? 512 : 256;
}

/** The tile whose visible bounds hold device coordinate v (TilingData::TileXIndexFromSrcCoord, one border texel). */
export function ccTileIndex(v: number, tileSize: number): number {
  const inner = tileSize - 2 * CC_BORDER_TEXELS;
  if (v < inner + CC_BORDER_TEXELS) return 0;
  return floorOf((v - CC_BORDER_TEXELS) / inner);
}

/** The first texel of tile i's bitmap (TilingData::TileBoundsWithBorder): the origin of its canvas and of the dither. */
export function ccTileStart(i: number, tileSize: number): number {
  return i * (tileSize - 2 * CC_BORDER_TEXELS);
}

/** One past the last texel of tile i's bitmap, before clamping to the layer. */
export function ccTileEnd(i: number, tileSize: number): number {
  return ccTileStart(i, tileSize) + tileSize;
}

type Color4 = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

type StopStage = { readonly factor: Color4; readonly bias: Color4 };

/** The compiled shader: the t matrix inputs and the gradient stage. */
export type GradientShader = {
  readonly scale: number;
  readonly axis: 'x' | 'y';
  readonly destStart: number;
  /** 'two' evenly_spaced_2_stop_gradient, 'even' evenly_spaced_gradient, 'stops' gradient (arbitrary positions). */
  readonly kind: 'two' | 'even' | 'stops';
  readonly clampT: boolean;
  readonly stages: readonly StopStage[];
  readonly ts: readonly number[];
  readonly opaque: boolean;
  readonly premulStage: boolean;
  readonly tileSize: number;
};

const RATE_8888 = 0.003921568859368563;
const INV_255 = 0.003921568859368563;

function f32(v: number): number {
  return froundOf(v);
}

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

function absNum(v: number): number {
  return v < 0 ? -v : v;
}

/**
 * vfmaq_f32: a * b + c with one float32 rounding. The product of two floats is exact in a double; the sum's rounding
 * error is recovered exactly (TwoSum), and only a double sum that lands on a float midpoint needs it to break the tie.
 */
export function fma32(a: number, b: number, c: number): number {
  const p = a * b;
  const s = p + c;
  const bb = s - p;
  const e = p - (s - bb) + (c - bb);
  const r = f32(s);
  if (e === 0 || r === s) return r;
  const other = 2 * s - r;
  if (f32(other) === other && other !== r) return e > 0 ? maxNum(r, other) : minNum(r, other);
  return r;
}

/** vcvtnq_u32_f32 on a value already clamped to [0, 255]: round half to even. */
export function roundHalfEven(v: number): number {
  const fl = floorOf(v);
  const diff = v - fl;
  if (diff > 0.5) return fl + 1;
  if (diff < 0.5) return fl;
  return fl - floorOf(fl / 2) * 2 === 0 ? fl : fl + 1;
}

function bit(v: number, k: number): number {
  let p = 1;
  for (let i = 0; i < k; i++) p = p * 2;
  return floorOf(v / p) - 2 * floorOf(v / (2 * p));
}

/** The 8x8 ordered dither matrix value M (0..63) at tile-local (x, y): bits fcebda of X = abc and X ^ Y = def. */
export function ditherIndex(x: number, y: number): number {
  const x0 = bit(x, 0);
  const x1 = bit(x, 1);
  const x2 = bit(x, 2);
  const y0 = absNum(x0 - bit(y, 0));
  const y1 = absNum(x1 - bit(y, 1));
  const y2 = absNum(x2 - bit(y, 2));
  return 32 * y0 + 16 * x0 + 8 * y1 + 4 * x1 + 2 * y2 + x2;
}

/** The dither stage's offset: mad(M, 2/128, -63/128), in (-0.5, +0.5). */
export function ditherOffset(x: number, y: number): number {
  return fma32(ditherIndex(x, y), 2 / 128, -63 / 128);
}

function color4(c: Rgba8): Color4 {
  return { r: f32(c.r / 255), g: f32(c.g / 255), b: f32(c.b / 255), a: f32(c.a / 255) };
}

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

const ZERO4: Color4 = { r: 0, g: 0, b: 0, a: 0 };

/** Builds the pipeline constants for one gradient, as SkLinearGradient::appendStages would. */
export function linearGradientShader(spec: LinearGradientSpec, faults: DitherFaults): GradientShader {
  // Blink FillSkiaStops: pad a stop at 0 and at 1 with the end colors.
  const pos: number[] = [];
  const colors: Color4[] = [];
  const first = spec.stops[0] as GradientStop;
  const last = spec.stops[spec.stops.length - 1] as GradientStop;
  if (f32(first.offset) > 0) {
    pos.push(0);
    colors.push(color4(first.color));
  }
  for (const s of spec.stops) {
    pos.push(f32(s.offset));
    colors.push(color4(s.color));
  }
  if ((pos[pos.length - 1] as number) < 1) {
    pos.push(1);
    colors.push(color4(last.color));
  }
  // SkGradientBaseShader: pin positions, detect uniform spacing (SkScalarNearlyEqual, 1/4096), dedupe repeated stops.
  const pinned: number[] = [0];
  let prev = 0;
  let uniform = true;
  const uniformStep = f32((pos[1] as number) - 0);
  for (let i = 1; i < pos.length; i++) {
    const curr = minNum(maxNum(pos[i] as number, prev), 1);
    if (absNum(uniformStep - f32(curr - prev)) > 1 / 4096) uniform = false;
    pinned.push(curr);
    prev = curr;
  }
  let opaque = true;
  for (const c of colors) if (c.a !== 1) opaque = false;
  const premulStops = !faults.gradientUnpremultiplied;
  const pm: Color4[] = [];
  for (const c of colors) pm.push(premulStops ? premul(c) : c);
  const premulStage = !premulStops && !opaque;
  const scale = axisScale(spec.axis === 'x' ? spec.width : spec.height);
  const destStart = spec.axis === 'x' ? spec.destLeft : spec.destTop;
  if (uniform) {
    if (pm.length === 2) {
      const l = pm[0] as Color4;
      const r = pm[1] as Color4;
      return { scale, axis: spec.axis, destStart, kind: 'two', clampT: true, stages: [{ factor: sub4(r, l), bias: l }], ts: [], opaque, premulStage, tileSize: spec.tileSize };
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
    return { scale, axis: spec.axis, destStart, kind: 'even', clampT: true, stages, ts: [], opaque, premulStage, tileSize: spec.tileSize };
  }
  // Dedupe (clamp tile mode): of a run of equal positions keep the leftmost and, if repeated, the rightmost.
  const dPos: number[] = [];
  const dCol: Color4[] = [];
  let i0 = 0;
  for (let j = 1; j <= pinned.length; j++) {
    if (j === pinned.length || (pinned[i0] as number) !== (pinned[j] as number)) {
      dPos.push(pinned[i0] as number);
      dCol.push(pm[i0] as Color4);
      if (j - i0 > 1) {
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
      const factor = scale4(sub4(cR, cL), cScale);
      ts.push(tL);
      stages.push({ factor, bias: sub4(cL, scale4(factor, tL)) });
    }
    tL = tR;
    cL = cR;
  }
  ts.push(tL);
  stages.push({ factor: ZERO4, bias: cL });
  return { scale, axis: spec.axis, destStart, kind: 'stops', clampT: false, stages, ts, opaque, premulStage, tileSize: spec.tileSize };
}

/**
 * pts_to_unit_matrix for (0,0)-(L,0) or (0,0)-(0,L): mag = L (sqrt of a float square is exact), inv = 1/L, the unit
 * vector's component c = L * inv, and the post-scaled entry inv * c.
 */
function axisScale(length: number): number {
  const inv = f32(1 / f32(length));
  const c = f32(f32(length) * inv);
  return f32(inv * c);
}

/**
 * One device pixel of the gradient drawn over dst (the page's 8888 pixel), at page device coordinates (x, y). The tile's
 * canvas translate makes the shader matrix's translate k * (tileOrigin - dest) and the dither's (dx, dy) tile-local.
 */
export function gradientPixel(shader: GradientShader, x: number, y: number, dst: Rgba8, faults: DitherFaults): Rgba8 {
  const tileX = ccTileStart(ccTileIndex(x, shader.tileSize), shader.tileSize);
  const tileY = ccTileStart(ccTileIndex(y, shader.tileSize), shader.tileSize);
  const coord = shader.axis === 'x' ? x - tileX : y - tileY;
  const tileStart = shader.axis === 'x' ? tileX : tileY;
  // seed_shader then matrix_scale_translate (or matrix_2x3 with a zero term): mad(coord + 0.5, k, k * (tile - dest)).
  const translate = f32(shader.scale * f32(tileStart - shader.destStart));
  let t = fma32(coord + 0.5, shader.scale, translate);
  if (shader.clampT) t = minNum(maxNum(0, t), 1);
  let idx = 0;
  if (shader.kind === 'even') idx = truncOf(f32(t * (shader.stages.length - 1)));
  if (shader.kind === 'stops') for (let i = 1; i < shader.ts.length; i++) if (t >= (shader.ts[i] as number)) idx += 1;
  const st = shader.stages[idx] as StopStage;
  let r = fma32(t, st.factor.r, st.bias.r);
  let g = fma32(t, st.factor.g, st.bias.g);
  let b = fma32(t, st.factor.b, st.bias.b);
  let a = fma32(t, st.factor.a, st.bias.a);
  if (shader.premulStage) {
    r = f32(r * a);
    g = f32(g * a);
    b = f32(b * a);
  }
  if (!faults.ditherDisabled) {
    // Planted: index the matrix by page coordinates instead of the tile's.
    const d = faults.ditherPhaseShift ? ditherOffset(x, y) : ditherOffset(x - tileX, y - tileY);
    r = maxNum(0, minNum(fma32(d, RATE_8888, r), a));
    g = maxNum(0, minNum(fma32(d, RATE_8888, g), a));
    b = maxNum(0, minNum(fma32(d, RATE_8888, b), a));
  }
  r = minNum(maxNum(0, r), 1);
  g = minNum(maxNum(0, g), 1);
  b = minNum(maxNum(0, b), 1);
  a = minNum(maxNum(0, a), 1);
  if (!shader.opaque) {
    // load_8888_dst and srcover: mad(d, 1 - a, s).
    const inv = f32(1 - a);
    r = fma32(f32(dst.r * INV_255), inv, r);
    g = fma32(f32(dst.g * INV_255), inv, g);
    b = fma32(f32(dst.b * INV_255), inv, b);
    a = fma32(f32(dst.a * INV_255), inv, a);
  }
  return { r: toUnorm(r), g: toUnorm(g), b: toUnorm(b), a: toUnorm(a) };
}

/** store_8888's to_unorm(v, 255): round(min(max(0, mad(v, 255, 0)), 255)). */
function toUnorm(v: number): number {
  return roundHalfEven(minNum(maxNum(0, fma32(v, 255, 0)), 255));
}
