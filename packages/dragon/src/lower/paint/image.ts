// REPL-a Phase B (R6) and SVG-a2 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): replaced content is Dragon-owned paint. An
// inline <svg> lowers to its viewBox and shapes (svg-shapes), which the device fills and strokes as paths over the content box. An
// image is drawn as before. The lowering embeds the image bytes (an 8-bit sRGB PNG the build
// read, images/compile.ts) with its natural size and object-fit; the device decodes them once when the view is built and draws
// the bitmap into the engine's destination rect, clipped to the content box (layout paint.ts replacedPaint). UIImageView
// contentMode and ImageView ScaleType are not used: neither expresses object-position.
import type { ObjectFit } from '@dragon/layout';
import { svgPaintAlpha, type Rgba8 } from '../../css/color.ts';
import { svgSceneOf, svgShapeEmpty } from '../../analysis/elements/svg.ts';
import type { SvgFillRule, SvgLineCap, SvgLineJoin, SvgPaint, SvgShapeScene } from '../../analysis/elements/svg.ts';
import { base64Encode } from '../../images/compile.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ImageWrite = {
  readonly kind: 'replaced-image';
  /** The PNG bytes, base64. */
  readonly data: string;
  /** The natural size in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly fit: ObjectFit;
  /**
   * Whether the Android stage may draw through its own layer: false when the img or an ancestor has a transform that moves at
   * run time, whose change would not redraw the img and would leave a layer resampled under the new matrix.
   */
  readonly layer: boolean;
};

/**
 * One shape of an svg-shapes write: its outline as verb-coded user-unit numbers (0 move x y, 1 line x y, 2 quad x1 y1 x y, 3 cubic
 * x1 y1 x2 y2 x y, 4 close, 5 circle cx cy r), its fill and stroke (null for none), its stroke width in user units, and (SVG-stroke)
 * its stroke-linecap, stroke-linejoin, stroke-miterlimit and fill-rule, and (SVG-dash) its dashes in user units ([] for a solid
 * stroke, else an even list) and the phase into them the stroke starts at (svgDashPhase), and (SVG-paint-order) whether its stroke
 * paints before its fill.
 */
export type SvgShapeData = {
  readonly path: readonly number[];
  readonly fill: Rgba8 | null;
  readonly stroke: Rgba8 | null;
  readonly width: number;
  readonly cap: SvgLineCap;
  readonly join: SvgLineJoin;
  readonly miterLimit: number;
  readonly fillRule: SvgFillRule;
  readonly dashes: readonly number[];
  readonly dashPhase: number;
  readonly strokeFirst: boolean;
};

export type SvgShapesWrite = {
  readonly kind: 'svg-shapes';
  /** The viewBox (min-x, min-y, width, height), or null for none. */
  readonly viewBox: readonly number[] | null;
  readonly shapes: readonly SvgShapeData[];
};

const paintColor = (p: SvgPaint, opacity: number): Rgba8 | null => (p.kind === 'none' ? null : opacity === 1 ? p.color : { ...p.color, alpha: svgPaintAlpha(p.color.alpha, opacity) });

/**
 * SVG-dash: where in the dash pattern a stroke starts, in [0, the pattern length): stroke-dashoffset wrapped into the pattern, as
 * Skia's SkDashPath::CalcDashParameters wraps the phase Chrome passes it (a negative offset counts back from the pattern's end).
 * CoreGraphics' setLineDash phase and Android's DashPathEffect phase are this same distance into the pattern.
 */
export function svgDashPhase(dashes: readonly number[], offset: number): number {
  const length = dashes.reduce((a, b) => a + b, 0);
  if (length === 0) return 0;
  const phase = offset % length;
  if (phase >= 0) return phase + 0;
  // + 0 makes -0 (an offset of minus whole patterns) 0; a tiny negative remainder can round up to the pattern's length.
  return phase + length === length ? 0 : phase + length;
}

/** The cubic control distance of a quarter ellipse, as a fraction of its radius: 4/3 (sqrt 2 - 1). */
const QUARTER_ARC_KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/**
 * SVG-rrect: a rounded rect's outline, in the order Blink's PathBuilder::AddRoundedRect (path_builder.cc) builds it (clockwise,
 * start index 0) and Skia's set_as_rrect (SkPathRawShapes.cpp) lays it out: from the top edge's left end (SkPath_RRectPointIterator
 * point 0, SkPathMakers.h), each edge's line then its corner, closed; an oval (both radii at half the size) is set_as_oval's four
 * quarters from the top centre, with no lines (SkPathPriv::SimplifyRRect, SkPathPriv.h). Skia draws each corner as a conic of
 * weight sqrt(2)/2, an exact quarter ellipse; CoreGraphics and android.graphics.Path have no conic, so each is the cubic that
 * approximates it (within 0.03% of the radius).
 */
function roundedRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): number[] {
  const [l, t, r, b] = [x, y, x + w, y + h];
  const [kx, ky] = [rx * QUARTER_ARC_KAPPA, ry * QUARTER_ARC_KAPPA];
  const corners = [
    [3, r - rx + kx, t, r, t + ry - ky, r, t + ry],
    [3, r, b - ry + ky, r - rx + kx, b, r - rx, b],
    [3, l + rx - kx, b, l, b - ry + ky, l, b - ry],
    [3, l, t + ry - ky, l + rx - kx, t, l + rx, t],
  ];
  if (rx * 2 === w && ry * 2 === h) return [0, l + rx, t, ...corners.flat(), 4];
  const lines = [[1, r - rx, t], [1, r, b - ry], [1, l + rx, b], [1, l, t + ry]];
  return [0, l + rx, t, ...lines.flatMap((line, i) => [...line, ...(corners[i] as number[])]), 4];
}

/** A shape's outline as verb-coded numbers (SvgShapeData.path). A rect is its four sides, closed, as Blink builds it. */
export function svgShapePath(s: SvgShapeScene): number[] {
  const g = s.shape;
  if (g.kind === 'circle') return [5, g.cx, g.cy, g.r];
  if (g.kind === 'rect' && g.rx !== undefined && g.ry !== undefined) return roundedRectPath(g.x, g.y, g.width, g.height, g.rx, g.ry);
  if (g.kind === 'rect') return [0, g.x, g.y, 1, g.x + g.width, g.y, 1, g.x + g.width, g.y + g.height, 1, g.x, g.y + g.height, 4];
  return g.segments.flatMap((v) => (v.kind === 'move' ? [0, v.x, v.y] : v.kind === 'line' ? [1, v.x, v.y] : v.kind === 'quad' ? [2, v.x1, v.y1, v.x, v.y] : v.kind === 'cubic' ? [3, v.x1, v.y1, v.x2, v.y2, v.x, v.y] : [4]));
}

const SVG_PAINT = 'each shape filled (its fill-rule) and stroked (its stroke-linecap, stroke-linejoin, stroke-miterlimit and dash pattern) in its paint, in its paint-order, antialiased, through the viewBox transform of the snapped content box, clipped to it (the UA overflow: hidden)';

const IMAGE_PAINT = 'the PNG decoded once at build (sRGB, unpremultiplied source); drawn into the engine destination rect snapped to device px, clipped to the snapped content box';

export const IMAGE_LOWERING: PaintLowering<ImageWrite | SvgShapesWrite> = {
  name: 'image',
  vocabulary: {
    uikit: {
      'replaced-image': { key: 'dragonImage', technique: 'dragon-owned-paint', detail: `DragonBoxView CGImage drawn with UIImage.draw(in:) in the box layer: ${IMAGE_PAINT}; the destination rect in points` },
      'svg-shapes': { key: 'dragonSvg', technique: 'dragon-owned-paint', detail: `DragonBoxView CGPaths filled and stroked with CGContext in the box layer: ${SVG_PAINT}` },
    },
    'android-views': {
      'replaced-image': { key: 'dragonImage', technique: 'dragon-owned-paint', detail: `DragonBoxView Bitmap drawn with Canvas.drawBitmap(src, dst, Paint(FILTER_BITMAP_FLAG)): ${IMAGE_PAINT}; the destination rect in device px` },
      'svg-shapes': { key: 'dragonSvg', technique: 'dragon-owned-paint', detail: `DragonBoxView android.graphics.Paths drawn with Canvas.drawPath (Paint FILL and STROKE): ${SVG_PAINT}` },
    },
  },
  css: { 'replaced-image': ['object-fit', 'object-position'], 'svg-shapes': ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'stroke-dasharray', 'stroke-dashoffset', 'cx', 'cy', 'r', 'x', 'y', 'paint-order', 'rx', 'ry'] },
  lower: ({ box, el, images, transformMoves }) => {
    if (box.kind === 'replaced' && el !== null && el.element.tag === 'svg') {
      const scene = svgSceneOf(el);
      // A shape Chrome renders nothing for (svgShapeEmpty) is not drawn: a zero-size rect's closed outline would stroke as a line.
      // Nor is one Chrome does not paint (hidden, or opacity 0).
      if (scene === null) throw new ProgramError(`${box.id}: an svg leaf without a scene`);
      const v = scene.viewBox;
      return [{ kind: 'svg-shapes', viewBox: v === null ? null : [v.x, v.y, v.width, v.height], shapes: scene.shapes.filter((sh) => sh.painted && !svgShapeEmpty(sh.shape)).map((sh) => ({ path: svgShapePath(sh), fill: paintColor(sh.fill, sh.fillOpacity), stroke: paintColor(sh.stroke, sh.strokeOpacity), width: sh.strokeWidth, cap: sh.cap, join: sh.join, miterLimit: sh.miterLimit, fillRule: sh.fillRule, dashes: sh.dashes, dashPhase: svgDashPhase(sh.dashes, sh.dashOffset), strokeFirst: sh.strokeFirst })) }];
    }
    if (box.kind !== 'replaced' || el === null || el.element.tag !== 'img') return [];
    if (box.natural.kind !== 'image') throw new ProgramError(`${box.id}: an img leaf without a natural size`);
    const src = el.element.attributes.get('src');
    const bytes = src === undefined ? undefined : images.get(src);
    if (bytes === undefined) throw new ProgramError(`${box.id}: no image bytes for its src`);
    return [{ kind: 'replaced-image', data: base64Encode(bytes), width: box.natural.width, height: box.natural.height, fit: box.objectFit, layer: !transformMoves }];
  },
};
