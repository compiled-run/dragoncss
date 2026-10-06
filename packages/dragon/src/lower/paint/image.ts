// REPL-a Phase B (R6) and SVG-a2 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): replaced content is Dragon-owned paint. An
// inline <svg> lowers to its viewBox and shapes (svg-shapes), which the device fills and strokes as paths over the content box. An
// image is drawn as before. The lowering embeds the image bytes (an 8-bit sRGB PNG the build
// read, images/compile.ts) with its natural size and object-fit; the device decodes them once when the view is built and draws
// the bitmap into the engine's destination rect, clipped to the content box (layout paint.ts replacedPaint). UIImageView
// contentMode and ImageView ScaleType are not used: neither expresses object-position.
import type { ObjectFit } from '@dragon/layout';
import type { Rgba8 } from '../../css/color.ts';
import { svgSceneOf } from '../../analysis/elements/svg.ts';
import type { SvgPaint, SvgShapeScene } from '../../analysis/elements/svg.ts';
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
 * x1 y1 x2 y2 x y, 4 close, 5 circle cx cy r), its fill and stroke (null for none) and its stroke width in user units.
 */
export type SvgShapeData = { readonly path: readonly number[]; readonly fill: Rgba8 | null; readonly stroke: Rgba8 | null; readonly width: number };

export type SvgShapesWrite = {
  readonly kind: 'svg-shapes';
  /** The viewBox (min-x, min-y, width, height), or null for none. */
  readonly viewBox: readonly number[] | null;
  readonly shapes: readonly SvgShapeData[];
};

const paintColor = (p: SvgPaint): Rgba8 | null => (p.kind === 'none' ? null : p.color);

/** A shape's outline as verb-coded numbers (SvgShapeData.path). A rect is its four sides, closed, as Blink builds it. */
export function svgShapePath(s: SvgShapeScene): number[] {
  const g = s.shape;
  if (g.kind === 'circle') return [5, g.cx, g.cy, g.r];
  if (g.kind === 'rect') return [0, g.x, g.y, 1, g.x + g.width, g.y, 1, g.x + g.width, g.y + g.height, 1, g.x, g.y + g.height, 4];
  return g.segments.flatMap((v) => (v.kind === 'move' ? [0, v.x, v.y] : v.kind === 'line' ? [1, v.x, v.y] : v.kind === 'quad' ? [2, v.x1, v.y1, v.x, v.y] : v.kind === 'cubic' ? [3, v.x1, v.y1, v.x2, v.y2, v.x, v.y] : [4]));
}

const SVG_PAINT = 'each shape filled (non-zero) then stroked (butt caps, miter joins, miter limit 4) in its paint, antialiased, through the viewBox transform of the snapped content box, clipped to it (the UA overflow: hidden)';

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
      'svg-shapes': { key: 'dragonSvg', technique: 'dragon-owned-paint', detail: `DragonBoxView android.graphics.Paths drawn with Canvas.drawPath (Paint FILL, then STROKE): ${SVG_PAINT}` },
    },
  },
  css: { 'replaced-image': ['object-fit', 'object-position'], 'svg-shapes': ['fill', 'stroke', 'stroke-width'] },
  lower: ({ box, el, images, transformMoves }) => {
    if (box.kind === 'replaced' && el !== null && el.element.tag === 'svg') {
      const scene = svgSceneOf(el);
      if (scene === null) throw new ProgramError(`${box.id}: an svg leaf without a scene`);
      const v = scene.viewBox;
      return [{ kind: 'svg-shapes', viewBox: v === null ? null : [v.x, v.y, v.width, v.height], shapes: scene.shapes.map((sh) => ({ path: svgShapePath(sh), fill: paintColor(sh.fill), stroke: paintColor(sh.stroke), width: sh.strokeWidth })) }];
    }
    if (box.kind !== 'replaced' || el === null || el.element.tag !== 'img') return [];
    if (box.natural.kind !== 'image') throw new ProgramError(`${box.id}: an img leaf without a natural size`);
    const src = el.element.attributes.get('src');
    const bytes = src === undefined ? undefined : images.get(src);
    if (bytes === undefined) throw new ProgramError(`${box.id}: no image bytes for its src`);
    return [{ kind: 'replaced-image', data: base64Encode(bytes), width: box.natural.width, height: box.natural.height, fit: box.objectFit, layer: !transformMoves }];
  },
};
