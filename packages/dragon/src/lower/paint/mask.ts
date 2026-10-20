// MASK-CLIP (css-masking-1 §7): a box whose mask is one linear-gradient() over the initial mask longhands
// (analysis/paint-values/mask.ts gradientMaskOf) gets one write holding the gradient (its linear slope folded from the measured libm
// table, as BG2's layers fold theirs) and the origin of the composited layer it rasters in. The device rasterises it with the
// translated paint-gradient.ts as one background layer over the border box (size auto, position 0% 0%, repeat, origin and clip
// border-box) after every layout and masks the box view, and every view inside it, by the raster's alpha. Nothing on the device
// parses CSS.
import { gradientMaskOf } from '../../analysis/paint-values/mask.ts';
import { compositesSubtree, linearSlope, unfoldedLength } from '../../analysis/paint-values/gradient.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import { MASK_LONGHANDS } from '../../css/properties/mask.ts';
import type { LoweredGradient, LoweredStop } from './gradient.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type MaskWrite = {
  readonly kind: 'mask-image';
  /** The mask's gradient with its stop colours resolved; only their alpha masks. */
  readonly gradient: LoweredGradient;
  /** The composited layer's origin in page device px (BG2 R4): the root scroller's is (0, 0). */
  readonly layerOrigin: readonly [number, number];
};

export const MASK_LOWERING: PaintLowering<MaskWrite> = {
  name: 'mask',
  vocabulary: {
    uikit: { 'mask-image': { key: 'dragonMaskImage', technique: 'dragon-owned-paint', detail: "the translated paint-gradient.ts rasterises the gradient as one layer over the border box into premultiplied device-pixel CGImages at every layout, the contents of the box view's layer.mask (nearest filtering, one image pixel per device pixel), which masks the box and every view inside it by alpha and leaves their accessibility untouched" } },
    'android-views': { 'mask-image': { key: 'dragonMaskImage', technique: 'dragon-owned-paint', detail: "the translated paint-gradient.ts rasterises the gradient as one layer over the border box into premultiplied device-pixel Bitmaps (copyPixelsFromBuffer) at every layout, drawn 1:1 with a DST_IN Paint by an overlay drawable of the box view in its hardware layer, which masks the box and every view inside it by alpha and leaves their visibility untouched" } },
  },
  css: { 'mask-image': [...MASK_LONGHANDS] },
  lower: ({ el }) => {
    if (el === null) return [];
    const g = gradientMaskOf(el);
    if (g === null) return [];
    const id = el.element.address;
    const slope = g.direction === 'angle' ? linearSlope(g.angleDeg) : 0;
    if (slope === null) throw new ProgramError(`${id}: the mask angle ${g.angleDeg}deg is off the measured grid, which the native check refuses (BG2b)`);
    if (g.direction === 'side' && g.sideX !== 'none' && g.sideY !== 'none') throw new ProgramError(`${id}: a mask gradient to a corner, which the native check refuses (BG2b)`);
    if (unfoldedLength((el.props.get('mask-image') as ResolvedValue).value) !== null) throw new ProgramError(`${id}: a mask stop length relative to a font size, which the native check refuses (CALC-p)`);
    if (compositesSubtree(el)) throw new ProgramError(`${id}: a mask in a composited layer, which the native check refuses (MASK-CLIP)`);
    const stops = g.stops.map((s): LoweredStop => {
      if (s.color.kind === 'currentcolor') throw new ProgramError(`${id}: a currentcolor mask stop, which the native check refuses (MASK-CLIP)`);
      return { color: s.color.value, unit: s.unit, value: s.value };
    });
    return [{ kind: 'mask-image', gradient: { ...g, slope, stops }, layerOrigin: [0, 0] }];
  },
};
