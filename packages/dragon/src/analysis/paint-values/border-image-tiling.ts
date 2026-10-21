// MISC-PAINT part 2 on the native targets: a gradient border image with border-image-repeat repeat, round or space. Chrome tiles an
// edge or the middle through a paint-record shader (GeneratedImage::DrawPattern) whose tile image SkPictureShader rasters at
// ceil(scale * tile size) px; paint-gradient.ts planBorderImage models a tiled piece only where that tile image is drawn 1:1 at whole
// device px, and leaves the plan unmodelled otherwise (the device then throws). A gradient's image is the border box itself, so every
// tile size, phase and spacing depends on the laid-out box. The compiler accepts a tiled border image only when it proves the box's
// border box and border widths exactly, in device px at every device scale of the target, and planBorderImage models that box at
// every sub-pixel position (64 LU offsets per axis). Anything it cannot prove is refused at border-image-repeat on ios and android.
import type { BorderImagePaint, GradientImage } from '@dragon/layout';
import { fromCssPx, NO_GRADIENT_FAULTS, planBorderImage, referenceTileSize } from '@dragon/layout';
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

/** snapBorderWidth in device px: a width of a device px or more floors, a thinner non-zero one is 1. */
function borderDevicePx(css: number, dpr: number): number {
  const d = css * dpr;
  return d >= 1 ? Math.floor(d) : d > 0 ? 1 : 0;
}

/** The box's border box at a device scale, raw LU, and its border widths in device px: [width, height, top, right, bottom, left]. */
export function deviceBox(b: ExactBox, dpr: number): readonly number[] {
  const bd = b.borders.map((v) => borderDevicePx(v, dpr));
  const pad = b.padding.map((v) => fromCssPx(v * dpr));
  const t = bd[0] as number;
  const r = bd[1] as number;
  const bo = bd[2] as number;
  const l = bd[3] as number;
  const extraX = (pad[1] as number) + (pad[3] as number) + (r + l) * 64;
  const extraY = (pad[0] as number) + (pad[2] as number) + (t + bo) * 64;
  const w = fromCssPx(b.width * dpr);
  const h = fromCssPx(b.height * dpr);
  const width = b.borderBox ? Math.max(w, extraX) : w + extraX;
  const height = b.borderBox ? Math.max(h, extraY) : h + extraY;
  return [width, height, t, r, bo, l];
}

/** The first device scale of dprs at which some sub-pixel position of the box leaves the plan of paint unmodelled, or null. */
export function unmodelledScale(paint: (dpr: number, x: number, y: number) => BorderImagePaint, dprs: readonly number[]): number | null {
  for (const dpr of dprs) {
    for (let k = 0; k < 64; k++) {
      if (!planBorderImage(paint(dpr, k, 0), NO_GRADIENT_FAULTS).modelled) return dpr;
      if (!planBorderImage(paint(dpr, 0, k), NO_GRADIENT_FAULTS).modelled) return dpr;
    }
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
    let scales: readonly number[] = [];
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
        const image: GradientImage = { ...w.gradient, stops: w.gradient.stops.map((s) => ({ color: { r: s.color.r, g: s.color.g, b: s.color.b, alpha: s.color.alpha }, unit: s.unit, value: s.value })) };
        const paint = (dpr: number, x: number, y: number): BorderImagePaint => {
          const d = deviceBox(box, dpr);
          return {
            box: { x, y, width: d[0] as number, height: d[1] as number, borders: d.slice(2).map((v) => v * 64), padding: [0, 0, 0, 0], obscures: [false, false, false, false] },
            image,
            slices: w.slices,
            fill: w.fill,
            widths: w.widths,
            zoom: dpr,
            tileSize: referenceTileSize(dpr),
            layerX: 0,
            layerY: 0,
            repeatX: w.repeat[0],
            repeatY: w.repeat[1],
          };
        };
        scales = native.map((t) => unmodelledScale(paint, NATIVE_DEVICE_DPRS[t]) ?? 0);
      } else if (why === null) return;
    }
    const v = el.props.get('border-image-repeat' as Longhand) as ResolvedValue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    native.forEach((t, i) => {
      const dpr = scales[i] ?? 0;
      if (why === null && dpr === 0) return;
      const id = `${t}|border-image-tiling|${el.element.address}`;
      if (reported.has(id)) return;
      reported.add(id);
      const reason = why ?? `at DPR ${dpr} a tile, its spacing or its phase is not a whole device px (or its scale is not a power of two), which Chrome rasters through a resampled tile image the native raster does not model`;
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
