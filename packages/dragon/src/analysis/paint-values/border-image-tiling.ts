// MISC-PAINT part 2 on the native targets: a gradient border image with border-image-repeat repeat, round or space. Chrome tiles an
// edge or the middle through a paint-record shader (GeneratedImage::DrawPattern) whose tile image SkPictureShader rasters at
// ceil(scale * tile size) px; paint-gradient.ts planBorderImage models a tiled piece only where that tile image is drawn 1:1 at whole
// device px, and leaves the plan unmodelled otherwise (the device then throws). A gradient's image is the border box itself, so every
// tile size, phase and spacing depends on the laid-out box. The compiler accepts a tiled border image only when it proves the box's
// border box and border widths exactly, and tilingProblem proves, in exact arithmetic at every device scale of the target, that
// planBorderImage models it at every sub-pixel position (border-image-tiling.test.ts checks that against planBorderImage itself).
// Anything it cannot prove is refused at border-image-repeat on ios and android.
import type { Longhand } from '../../css/properties.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { BorderImageFaults } from '../../faults/border-image.ts';
import { borderImageWrite } from '../../lower/paint/border.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import { environmentOf } from '../resolve.ts';
import { borderImageOf, borderImageRefusal } from './border-image.ts';
import type { WidthKeywords } from './gradient-phase.ts';
import { NATIVE_DEVICE_DPRS, usedLower } from './gradient-phase.ts';

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;
/** Displays whose box takes a px width and height as written. */
const SIZED: ReadonlySet<string> = new Set(['block', 'flow-root', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid']);

const valueOf = (el: ResolvedElement, p: string): ResolvedValue['value'] | null => el.props.get(p as Longhand)?.value ?? null;
const keyword = (el: ResolvedElement, p: string): string | null => {
  const v = valueOf(el, p);
  return v !== null && v.kind === 'keyword' ? v.value : null;
};
/** A non-negative px length (a percentage of 0 is 0), or null. */
const px = (el: ResolvedElement, p: string): number | null => {
  const v = valueOf(el, p);
  if (v !== null && v.kind === 'length' && v.unit === 'px' && v.value >= 0) return v.value;
  if (v !== null && v.kind === 'percentage' && v.value === 0) return 0;
  return null;
};

/** The exact border box inputs of a box, in CSS px, or why they are not known at compile time. */
export type ExactBox = { readonly width: number; readonly height: number; readonly borderBox: boolean; readonly padding: readonly number[]; readonly borders: readonly number[] };

/** A used size on an axis exactly: a px size clamped by px or initial min and max sizes; null when another value takes part. */
function exactSize(el: ResolvedElement, size: string, min: string, max: string): number | null {
  const s = px(el, size);
  if (s === null) return null;
  const lo = keyword(el, min) === 'auto' ? 0 : px(el, min);
  const hi = keyword(el, max) === 'none' ? Number.POSITIVE_INFINITY : px(el, max);
  if (lo === null || hi === null) return null;
  return Math.max(lo, Math.min(hi, s));
}

/**
 * The box's exact sizing inputs: px width and height (min and max clamps in px), px padding and px border widths (0 under a none
 * or hidden style), on a horizontal block-level, flex, grid or inline-block box. A flex item must neither grow nor shrink on its
 * container's main axis (flex-grow 0, flex-basis auto, and gradient-phase.ts usedLower's proof that it does not shrink); a px
 * cross size is never stretched. A display: contents parent hands the box to a context this does not follow.
 */
export function exactBox(el: ResolvedElement, ancestors: readonly ResolvedElement[], kw: WidthKeywords): ExactBox | string {
  const display = keyword(el, 'display') ?? '';
  if (!SIZED.has(display)) return `its display (${display || 'other'}) does not take its size as written`;
  if ((keyword(el, 'writing-mode') ?? 'horizontal-tb') !== 'horizontal-tb') return 'its writing mode is not horizontal-tb';
  const width = exactSize(el, 'width', 'min-width', 'max-width');
  const height = exactSize(el, 'height', 'min-height', 'max-height');
  if (width === null || height === null) return 'its width or height (with min and max sizes) is not a px length';
  const padding = SIDE_NAMES.map((s) => px(el, `padding-${s}`));
  if (padding.some((p) => p === null)) return 'a padding is not a px length';
  const borders: number[] = [];
  for (const s of SIDE_NAMES) {
    const style = keyword(el, `border-${s}-style`);
    if (style === 'none' || style === 'hidden') {
      borders.push(0);
      continue;
    }
    const b = px(el, `border-${s}-width`);
    if (b === null) return `the ${s} border width is not a px length`;
    borders.push(b);
  }
  const parent = ancestors[ancestors.length - 1] ?? null;
  if (parent !== null && keyword(parent, 'display') === 'contents') return 'its parent has display: contents';
  const position = keyword(el, 'position') ?? 'static';
  if (parent !== null && position !== 'absolute' && position !== 'fixed' && ['flex', 'inline-flex'].includes(keyword(parent, 'display') ?? '')) {
    const dir = keyword(parent, 'flex-direction') ?? 'row';
    const axis = dir === 'row' || dir === 'row-reverse' ? 'x' : 'y';
    const grow = valueOf(el, 'flex-grow');
    if (grow === null || grow.kind !== 'number' || grow.value !== 0) return 'it is a flex item that may grow';
    if (keyword(el, 'flex-basis') !== 'auto' || usedLower(el, axis, ancestors, kw) === null) return 'it is a flex item that Dragon cannot prove does not shrink';
  }
  return { width, height, borderBox: keyword(el, 'box-sizing') === 'border-box', padding: padding as number[], borders };
}

/** The border image inputs the tiling proof reads (a BorderImageWrite's). */
export type TilingInputs = {
  readonly slices: readonly { readonly unit: 'number' | 'percent'; readonly value: number }[];
  readonly widths: readonly { readonly unit: 'number' | 'px' | 'auto'; readonly value: number }[];
  readonly fill: boolean;
  readonly repeat: readonly string[];
};

/** The bound on every device px quantity, so that each is exact in float on the 1/2048 px grid (22 significant bits at most). */
const BOUND = 4096;
/** A device px quantity on the 1/2048 px grid within the bound: exact in float, and in Blink's float arithmetic over it. */
const fine = (v: number): boolean => Number.isInteger(v * 2048) && v > -BOUND && v < BOUND;
/** A power of two between 1/16 and 16 (planBorderImage accepts 1/256 to 256; the narrower range keeps every product on the grid). */
function powerOfTwo(v: number): boolean {
  for (let p = 1 / 16; p <= 16; p = p * 2) if (v === p) return true;
  return false;
}
/** The quotient and remainder of a / b for b > 0 on the 1/2048 grid, as whole numbers of grid steps (integer division). */
function divide(a: number, b: number): readonly [number, number] {
  const n = a * 2048;
  const m = b * 2048;
  const r = n % m;
  return [(n - r) / m, r / 2048];
}

/** ComputeTileParameters on one axis (paint-gradient.ts tileParameters) exactly: [scale, phase, spacing]; [] for space with no tile, null off the grid. */
function tileParameters(rule: string, dst: number, src: number): readonly number[] | null {
  if (rule === 'stretch') return [1, 0, 0];
  if (rule === 'repeat') return [1, (dst - src) / 2, 0];
  const [q, r] = divide(dst, src);
  if (rule === 'round') {
    // roundf(dst / src), half away from zero, at least 1.
    const reps = q + (2 * r >= src ? 1 : 0) || 1;
    const scale = dst / (src * reps);
    return powerOfTwo(scale) && scale * src * reps === dst ? [scale, 0, 0] : null;
  }
  if (q === 0) return [];
  const space = (dst - src * q) / (q + 1);
  return fine(space) && space * (q + 1) === dst - src * q ? [1, space, space] : null;
}

/**
 * Whether paint-gradient.ts tiledPiece models one tiled piece (src and dest [x, y, width, height] in image and device px, the
 * tile scale on each axis, the rules) 1:1: each scale a power of two, the tile image's raster size, its content and its origin
 * whole device px, the raster at most 2048 x 2048 px in area. Every input is exact on the grid, so Blink's float arithmetic over
 * them is exact too. A space axis that fits no tile draws nothing.
 */
function pieceTiles(src: readonly number[], dst: readonly number[], tsx: number, tsy: number, rx: string, ry: string): boolean {
  /** [raster size] for a modelled axis, [] for an axis that draws nothing, null for an unmodelled one. */
  const axis = (sw: number, d: number, dw: number, ts: number, rule: string): readonly number[] | null => {
    const p = tileParameters(rule, dw, sw * ts);
    if (p === null) return null;
    if (p.length === 0) return [];
    const scale = ts * (p[0] as number);
    const raster = scale * (sw + (p[2] as number));
    const origin = d + (p[1] as number);
    return powerOfTwo(scale) && fine(raster) && Number.isInteger(raster) && raster >= 1 && Number.isInteger(scale * sw) && fine(origin) && Number.isInteger(origin) ? [raster] : null;
  };
  const x = axis(src[2] as number, dst[0] as number, dst[2] as number, tsx, rx);
  const y = axis(src[3] as number, dst[1] as number, dst[3] as number, tsy, ry);
  if (x === null || y === null) return false;
  if (x.length === 0 || y.length === 0) return true;
  return (x[0] as number) * (y[0] as number) <= 4194304;
}

/**
 * Why paint-gradient.ts planBorderImage may leave a tiled border image of the box unmodelled at a device scale, or null when it
 * models it at every position. The proof keeps every quantity a whole device px or exact on the 1/2048 px grid: the border box,
 * its border widths and the border image widths whole device px, the slices exact, so the snapped area is the box at any
 * sub-pixel position and every piece moves by whole device px with it. It mirrors planBorderImage's grid in exact arithmetic,
 * then each tiled piece as tiledPiece judges it.
 */
export function tilingProblem(b: ExactBox, t: TilingInputs, dpr: number): string | null {
  const GRID = 'a tile, its spacing or its phase is not a whole device px (or its scale is not a power of two), which Chrome rasters through a resampled tile image the native raster does not model';
  for (const v of [b.width, b.height, ...b.padding, ...b.borders]) if (!Number.isInteger(v * 64) || !Number.isInteger(v * dpr * 64)) return 'a size, padding or border width is not a whole LayoutUnit';
  const bd = b.borders.map((v) => v * dpr);
  if (bd.some((v) => !Number.isInteger(v))) return 'a border width is not a whole device px';
  const [bt, br, bb, bl] = bd as [number, number, number, number];
  const extraX = (b.padding[1] as number) * dpr + (b.padding[3] as number) * dpr + br + bl;
  const extraY = (b.padding[0] as number) * dpr + (b.padding[2] as number) * dpr + bt + bb;
  const w = b.borderBox ? Math.max(b.width * dpr, extraX) : b.width * dpr + extraX;
  const h = b.borderBox ? Math.max(b.height * dpr, extraY) : b.height * dpr + extraY;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return 'the border box is not a whole device px';
  if (w <= 0 || h <= 0) return null;
  if (w >= BOUND || h >= BOUND) return `the border box is ${BOUND} device px or more`;
  // ComputeEdgeSlice: a whole number times the zoom (rounded to a LayoutUnit, which absorbs the float slice scale), or a whole
  // percentage of the image side; at most the side.
  const slice = (i: number, side: number): number | null => {
    const s = t.slices[i];
    if (s === undefined || !Number.isInteger(s.value) || s.value < 0) return null;
    const v = s.unit === 'number' ? s.value * dpr : (side * s.value) / 100;
    if (!Number.isInteger(v * 64)) return null;
    return Math.min(v, side);
  };
  const sl = [slice(0, h), slice(1, w), slice(2, h), slice(3, w)];
  if (sl.some((v) => v === null)) return 'a border-image-slice is not a whole number, or a whole percentage that is a whole LayoutUnit';
  const [st, sr, sb, sll] = sl as [number, number, number, number];
  // ComputeEdgeWidth: whole device px only, so SnapEdgeWidths keeps each. auto is the slice over the float zoom ratio of the
  // image, exact only where the zoom is a power of two.
  const width = (i: number, border: number, s: number): number | null => {
    const x = t.widths[i];
    if (x === undefined) return null;
    if (x.unit === 'number') return Number.isInteger(x.value * border) && x.value >= 0 ? x.value * border : null;
    if (x.unit === 'px') return Number.isInteger(x.value * 64) && Number.isInteger(x.value * dpr) && x.value >= 0 ? x.value * dpr : null;
    return powerOfTwo(dpr) && Number.isInteger(s) ? s : null;
  };
  const wd = [width(0, bt, st), width(1, br, sr), width(2, bb, sb), width(3, bl, sll)];
  if (wd.some((v) => v === null)) return 'a border-image-width is not a whole device px (an auto width is one only at a power-of-two scale)';
  const [top, right, bottom, left] = wd as [number, number, number, number];
  if (left + right > w || top + bottom > h) return 'its border-image-widths overlap, and Chrome scales them down off the device px grid';
  const esw = Math.max(0, w - (sll + sr));
  const esh = Math.max(0, h - (st + sb));
  const edw = w - (left + right);
  const edh = h - (top + bottom);
  const drawTop = st > 0 && top > 0;
  const drawRight = sr > 0 && right > 0;
  const drawBottom = sb > 0 && bottom > 0;
  const drawLeft = sll > 0 && left > 0;
  const scaleTop = drawTop ? top / st : 1;
  const scaleRight = drawRight ? right / sr : 1;
  const scaleBottom = drawBottom ? bottom / sb : 1;
  const scaleLeft = drawLeft ? left / sll : 1;
  const [rx, ry] = [t.repeat[0] ?? 'stretch', t.repeat[1] ?? 'stretch'];
  let midX = drawTop ? scaleTop : drawBottom ? scaleBottom : dpr;
  let midY = drawLeft ? scaleLeft : drawRight ? scaleRight : dpr;
  if (esw > 0 && esh > 0) {
    if (rx === 'stretch') midX = edw / esw;
    if (ry === 'stretch') midY = edh / esh;
  }
  // The tiled pieces (a corner, or a piece stretched both ways, is drawn directly): [src, dest, tile scales, rules].
  const tiled: (readonly [readonly number[], readonly number[], number, number, string, string])[] = [];
  if (ry !== 'stretch') {
    if (drawLeft && esh > 0 && edh > 0) tiled.push([[0, st, sll, esh], [0, top, left, edh], scaleLeft, scaleLeft, 'stretch', ry]);
    if (drawRight && esh > 0 && edh > 0) tiled.push([[w - sr, st, sr, esh], [w - right, top, right, edh], scaleRight, scaleRight, 'stretch', ry]);
  }
  if (rx !== 'stretch') {
    if (drawTop && esw > 0 && edw > 0) tiled.push([[sll, 0, esw, st], [left, 0, edw, top], scaleTop, scaleTop, rx, 'stretch']);
    if (drawBottom && esw > 0 && edw > 0) tiled.push([[sll, h - sb, esw, sb], [left, h - bottom, edw, bottom], scaleBottom, scaleBottom, rx, 'stretch']);
  }
  if (t.fill && esw > 0 && esh > 0 && edw > 0 && edh > 0 && (rx !== 'stretch' || ry !== 'stretch')) tiled.push([[sll, st, esw, esh], [left, top, edw, edh], midX, midY, rx, ry]);
  for (const [src, dst, tsx, tsy, x, y] of tiled) {
    if (![...src, ...dst].every(fine) || !powerOfTwo(tsx) || !powerOfTwo(tsy)) return GRID;
    if (!pieceTiles(src, dst, tsx, tsy, x, y)) return GRID;
  }
  return null;
}

/**
 * Refuses, on ios and android, every drawn gradient border image with a repeat other than stretch whose box Dragon cannot prove
 * exactly, or whose plan is unmodelled at a device scale of the target; planted fault borderImageTilingUnchecked accepts them.
 */
export function checkBorderImageTiling(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BorderImageFaults): void {
  const native = targets.filter((t): t is 'ios' | 'android' => t === 'ios' || t === 'android');
  if (native.length === 0 || faults.borderImageTilingUnchecked) return;
  const kw = environmentOf(root).ua.borderWidthKeywords;
  const walk = (el: ResolvedElement, ancestors: readonly ResolvedElement[]): void => {
    if (keyword(el, 'display') === 'none') return;
    check(el, ancestors);
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el]);
  };
  const check = (el: ResolvedElement, ancestors: readonly ResolvedElement[]): void => {
    const parts = borderImageOf(el);
    // Only a border image the other checks draw: a refused one is reported by them, and none draws nothing.
    if (parts === null || (parts.repeat[0] === 'stretch' && parts.repeat[1] === 'stretch') || borderImageRefusal(el) !== null) return;
    const box = exactBox(el, ancestors, kw);
    let why: string | null = typeof box === 'string' ? `Dragon cannot prove its border box exactly: ${box}` : null;
    let problems: readonly (string | null)[] = [];
    if (typeof box !== 'string') {
      let write: ReturnType<typeof borderImageWrite> = null;
      try {
        write = borderImageWrite(el.element.address, el);
      } catch (e) {
        // The context check refuses a box the lowering cannot write (a transformed or composited subtree); refuse it here too.
        why = `its border image has no native write here (${e instanceof Error ? e.message : String(e)})`;
      }
      if (write !== null) {
        const w = write;
        problems = native.map((t) => {
          for (const dpr of NATIVE_DEVICE_DPRS[t]) {
            const p = tilingProblem(box, w, dpr);
            if (p !== null) return `at DPR ${dpr} ${p}`;
          }
          return null;
        });
      } else if (why === null) return;
    }
    const v = el.props.get('border-image-repeat' as Longhand) as ResolvedValue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    native.forEach((t, i) => {
      const problem = problems[i] ?? null;
      if (why === null && problem === null) return;
      const id = `${t}|border-image-tiling|${el.element.address}`;
      if (reported.has(id)) return;
      reported.add(id);
      const reason = why ?? problem;
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `border-image-repeat: ${parts.repeat[0] === parts.repeat[1] ? parts.repeat[0] : parts.repeat.join(' ')} on <${el.element.tag}> ${el.element.address} is unsupported: ${reason} (MISC-PAINT)`,
        manual: 'Use border-image-repeat: stretch, or give the box a px width and height, px padding and px borders whose tiles land on whole device px (multiples of 8px do at DPR 2, 2.625 and 3).',
        basis: 'computed-value',
      }));
    });
  };
  walk(root, []);
}
