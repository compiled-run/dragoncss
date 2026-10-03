// REPL-a Phase B (R6): a replaced image is Dragon-owned paint. The lowering embeds the image bytes (an 8-bit sRGB PNG the build
// read, images/compile.ts) with its natural size and object-fit; the device decodes them once when the view is built and draws
// the bitmap into the engine's destination rect, clipped to the content box (layout paint.ts replacedPaint). UIImageView
// contentMode and ImageView ScaleType are not used: neither expresses object-position.
import type { ObjectFit } from '@dragon/layout';
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
};

const IMAGE_PAINT = 'the PNG decoded once at build (sRGB, unpremultiplied source); drawn into the engine destination rect snapped to device px, clipped to the snapped content box';

export const IMAGE_LOWERING: PaintLowering<ImageWrite> = {
  name: 'image',
  vocabulary: {
    uikit: { 'replaced-image': { key: 'dragonImage', technique: 'dragon-owned-paint', detail: `DragonBoxView CGImage drawn with UIImage.draw(in:) in the box layer: ${IMAGE_PAINT}; the destination rect in points` } },
    'android-views': { 'replaced-image': { key: 'dragonImage', technique: 'dragon-owned-paint', detail: `DragonBoxView Bitmap drawn with Canvas.drawBitmap(src, dst, Paint(FILTER_BITMAP_FLAG)): ${IMAGE_PAINT}; the destination rect in device px` } },
  },
  css: { 'replaced-image': ['object-fit', 'object-position'] },
  lower: ({ box, el, images }) => {
    if (box.kind !== 'replaced' || el === null || el.element.tag !== 'img') return [];
    if (box.natural.kind !== 'image') throw new ProgramError(`${box.id}: an img leaf without a natural size`);
    const src = el.element.attributes.get('src');
    const bytes = src === undefined ? undefined : images.get(src);
    if (bytes === undefined) throw new ProgramError(`${box.id}: no image bytes for its src`);
    return [{ kind: 'replaced-image', data: base64Encode(bytes), width: box.natural.width, height: box.natural.height, fit: box.objectFit }];
  },
};
